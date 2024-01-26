import { Client, Message, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
const cron = require('node-cron');
require('dotenv').config();


// config file
import config from '../whatsapp-ai.config';

// base types
import { AiModels } from '../types/AiModels';
import { AiModel } from '../models/AiModel';

// extends from base
import { GeminiModel } from '../models/GeminiModel';
import { GeminiVisionModel } from '../models/GeminiVisionModel';

// utilities
import { Util } from '../util/Util';

// hooks
import { useSpinner } from '../hooks/useSpinner';
import { IModelConfig } from '../types/Config';

class WhatsAppClient {
    private client;
    private aiModels: Map<AiModels, AiModel<string>>;
    private chatHistory: Map<string, string[]> = new Map();
    private productContext: { [key: string]: any } = {}; // Contexto de produto por ID do remetente
    private paymentContext: { [key: string]: any } = {}; // Contexto de produto por ID do remetente

    
    // Declaração da propriedade 'context'
    private context: { [senderId: string]: any };
    
    public constructor() {

        this.client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            },
            authStrategy: new LocalAuth()
        });

        this.aiModels = new Map<AiModels, AiModel<string>>();
        // init models
        this.aiModels.set('Gemini', new GeminiModel());
        this.aiModels.set('GeminiVision', new GeminiVisionModel());

        // Inicialização da propriedade 'context'
        this.context = {};
        
    }

    public initializeClient() {
        this.subscribeEvents();
        this.client.initialize();

        // Limpar o histórico todos os dias à meia-noite
        cron.schedule('0 0 * * *', () => {
        this.clearChatHistory();
    });
    }

    
    private async getJsonInfoFromAPI(apiPath: string): Promise<string> {
        try {
            const response = await axios.get(apiPath);
            return JSON.stringify(response.data);
        } catch (error) {
            console.error('Erro ao acessar a API:', error);
            return '';
        }
    }

    private clearChatHistory() {
        this.chatHistory.clear();
        console.log('Histórico do Chat Apagado!');
    }

    private subscribeEvents() {
        const spinner = useSpinner('WhatsApp Client | generating QR Code... \n');
        spinner.start();
        this.client
            .on('qr', (qr) => {
                WhatsAppClient.generateQrCode(qr);
                spinner.succeed(`QR has been generated! | Scan QR Code with your mobile.`);
            })
            .on('auth_failure', (message) => spinner.fail(`Authentication fail ${message}`))
            .on('authenticated', () => spinner.succeed('User Authenticated!'))
            .on('loading_screen', () => spinner.start('loading chat... \n'))
            .on('ready', () => spinner.succeed('Client is ready | All set!'))
            .on('message', async (msg) => this.onMessage(msg))
            .on('message_create', async (msg) => this.onSelfMessage(msg));
    }

    private static generateQrCode(qr: string) {
        QRCode.generate(qr, { small: true });
    }

    private async onMessage(message: Message) {
    const senderId = message.from;
    const msgStr = message.body;

    // Verifica se já existe um histórico para o remetente
    if (!this.chatHistory.has(senderId)) {
        this.chatHistory.set(senderId, []);
    }

    let currentHistory = this.chatHistory.get(senderId);

    // Se for a primeira mensagem do usuário, envie a apresentação
    if (currentHistory && currentHistory.length === 0) {
        const introMessage = `agora seu nome é Daniele, uma atendente da Alquimia Industria. Responda a pergunta abaixo dizendo seu nome e o lugar que trabalha: ${msgStr}`;
        const geminiModel = this.aiModels.get('Gemini');
        if (geminiModel) {
            geminiModel.sendMessage(introMessage, message);
            currentHistory.push(introMessage); // Adiciona a mensagem de introdução ao histórico
            return; // Interrompe o processamento adicional desta mensagem
        } else {
            console.error('Modelo Gemini não encontrado');
        }
    }
    
    if (currentHistory && currentHistory.length >= 10) {
        currentHistory.shift();
    }
    
    currentHistory?.push(msgStr);

    if (msgStr.length == 0) return;

    

    let fullPrompt = '';

    // Tente extrair informações sobre pagamento
    let paymentInfo = await this.extractPaymentKeyword(msgStr, senderId);
    if (paymentInfo) {
        fullPrompt = this.constructPromptWithPaymentContext(senderId, paymentInfo, msgStr);
        this.sendMessage(fullPrompt, message, config.enablePrefix.defaultModel);
    } else {
        // Tente extrair informações sobre produto
        let productInfo = await this.extractProductKeyword(msgStr, senderId);
        if (productInfo) {
            fullPrompt = this.constructPromptWithProductContext(senderId, productInfo, msgStr);
            this.sendMessage(fullPrompt, message, config.enablePrefix.defaultModel);
        } else {
            // Se nenhuma informação for encontrada, use o simplePrompt
            fullPrompt = `Responda apenas a informação abaixo:\n${msgStr}`;
            this.sendMessage(fullPrompt, message, config.enablePrefix.defaultModel);
        }
    }
}


    private async extractProductKeyword(message: string, senderId: string): Promise<string | null> {
        const productKeywords = [
            'produto', 'item', 'mercadoria', 'estoque', 'artigo', 
            'categoria', 'modelo', 'marca', 'oferta', 'lançamento', 
            'especificação', 'detalhe'
        ];
        const endpoint = 'http://localhost:3000/produtos';
        const messageLowerCase = message.toLowerCase();

        let jsonInfo = null; // Inicialize com null
    
        for (let keyword of productKeywords) {
            if (messageLowerCase.includes(keyword)) {
                try {
                    const response = await axios.get(endpoint);
                    const products = response.data;
                    this.productContext[senderId] = products; // Armazena as informações do produto
                    jsonInfo = this.formatProducts(products); // Formatar os produtos
                } catch (error) {
                    console.error('Erro ao acessar a API:', error);
                }
                
                break; // Saia do loop assim que encontrar uma correspondência
            }
        }
    
        return jsonInfo;
    }

    private formatProducts(products: any[]): string {
        return products.map(product => {
            return `Produto: ${product.nome}\nQuantidade: ${product.quantidade}\nPreço: ${product.preco}\nDescrição: ${product.descricao}\n`;
        }).join('\n');
    }

    private constructPromptWithProductContext(senderId: string, jsonInfo: string, msgStr: string): string {
        // Verifique se há informações do produto no contexto do remetente
        const productInfo = this.productContext[senderId];
        let productPrompt = '';
    
        if (productInfo) {
            // Se houver informações de produto, inclua no prompt
            productPrompt = `Informações do Produto Anterior:\n${this.formatProducts(productInfo)}\n\n`;
        }
    
        return `Abaixo temos informações do produto para consulta:${productPrompt} Abaixo as informações do banco: ${jsonInfo}\n\nPergunta: ${msgStr}`;
    }

    private async extractPaymentKeyword(message: string, senderId: string): Promise<string | null> {
        const paymentKeywords = [
            'pagamento', 'pix', 'transferência', 'dados bancários', 
            'email', 'comprovante', 'contato', 'link de pagamento'
        ];
        const endpoint = 'http://localhost:3000/pagamento';
        const messageLowerCase = message.toLowerCase();

        let jsonInfo = null; // Inicialize com null
    
        for (let keyword of paymentKeywords) {
            if (messageLowerCase.includes(keyword)) {
                try {
                    const response = await axios.get(endpoint);
                    const payments = response.data;
                    this.paymentContext[senderId] = payments; // Armazena as informações de pagamento
                    jsonInfo = this.formatPayments(payments); // Formatar os produtos
                } catch (error) {
                    console.error('Erro ao acessar a API:', error);
                }
                break; // Saia do loop assim que encontrar uma correspondência
            }
        }
    
        return jsonInfo;
    }

    private formatPayments(payments: any[]): string {
        return payments.map(payment => {
            return `Método de Pagamento: ${payment.metodo_pagamento}\nChave PIX: ${payment.chave_pix}\nDados Bancários: ${payment.dados_bancarios}\nEmail: ${payment.email_comprovante}\nContato: ${payment.contato_comprovante}\nLink de Pagamento: ${payment.link_pagamento}\n`;
        }).join('\n');
    }


    private constructPromptWithPaymentContext(senderId: string, jsonInfo: string, msgStr: string): string {
        const paymentInfo = this.paymentContext[senderId];
        let paymentsPrompt = '';
    
        if (paymentInfo) {
            paymentsPrompt = `Informações dos Métodos de Pagamento Anteriores:\n${this.formatPayments(paymentInfo)}\n\n`;
        }
    
        return `Abaixo temos informações de pagamentos para consulta:${paymentsPrompt} Abaixo as informações do banco: ${jsonInfo}\n\nPergunta: ${msgStr}`;
    }

    private async getJsonInfo(jsonPath: string): Promise<string> {
        try {
            const data = fs.readFileSync(path.resolve(__dirname, jsonPath), 'utf8');
            return JSON.stringify(JSON.parse(data), null, 2);
        } catch (err) {
            console.error(err);
            return '';
        }
    }

    private async onSelfMessage(message: Message) {
        if (!message.fromMe) return;  
        if (message.hasQuotedMsg && !Util.getModelByPrefix(message.body)) return;
        this.onMessage(message);
    }

    public async sendMessage(msgStr: string, message: Message, modelName: string) {
        const senderId = message.from;
        const history = this.chatHistory.get(senderId) || [];
        const historyString = history.join('\n');
    
        const fullPrompt = `Responda apenas a informação abaixo:\n${msgStr}`;
        
        const model = this.aiModels.get(modelName as AiModels);
        if (model) {
            model.sendMessage(fullPrompt, message);
        } else {
            console.error('Modelo não encontrado:', modelName);
        }
    }    
}

export { WhatsAppClient };
