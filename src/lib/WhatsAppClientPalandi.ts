import { Client, Message, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
import axios from 'axios';
const cron = require('node-cron');
require('dotenv').config();
import path from 'path';


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

const { NlpManager }: any = require('node-nlp');





class WhatsAppClient {
    private client;
    private aiModels: Map<AiModels, AiModel<string>>;
    private chatHistory: Map<string, string[]> = new Map();
    private nlpManager: any;
    private productContext: { [key: string]: any }; // ou um tipo mais específico, se aplicável
    private paymentContext: { [key: string]: any }; // ou um tipo mais específico, se aplicável



    public constructor() {
        this.client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            },
            authStrategy: new LocalAuth()
        });

        this.aiModels = new Map<AiModels, AiModel<string>>();
        this.aiModels.set('Gemini', new GeminiModel());
        this.aiModels.set('GeminiVision', new GeminiVisionModel());

        this.nlpManager = new NlpManager({ languages: ['pt'] });
        // Carregando o modelo NLP do arquivo
        const modelPath = path.join(__dirname, 'model.nlp');
        this.nlpManager.load(modelPath);

        this.productContext = {}; // Inicializa como um objeto vazio
        this.paymentContext = {}; // Inicializa como um objeto vazio


    }

    public initializeClient() {
        this.subscribeEvents();
        this.client.initialize();

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

    private async classifyAndRespond(message: Message) {
        const classification = await this.nlpManager.process('pt', message.body);
        const category = classification.intent;

        let responsePrompt = '';

        switch (category) {
            case 'produto':
                const productInfo = await this.getJsonInfoFromAPI('http://localhost:3000/produtos');
                responsePrompt = this.constructPromptWithProductContext(message.from, productInfo, message.body);
                break;
            case 'pagamento':
                const paymentInfo = await this.getJsonInfoFromAPI('http://localhost:3000/pagamentos');
                responsePrompt = this.constructPromptWithPaymentContext(message.from, paymentInfo, message.body);
                break;
            default:
                responsePrompt = `Responda apenas a informação abaixo:\n${message.body}`;
        }

        this.sendMessage(responsePrompt, message, config.enablePrefix.defaultModel);
    }

    private async onMessage(message: Message) {
        const senderId = message.from;
    
        if (!this.chatHistory.has(senderId)) {
            this.chatHistory.set(senderId, []);
        }
    
        // Verifique se a mensagem não é da AI
        if (!message.fromMe) {
            this.chatHistory.get(senderId)?.push(message.body);
        }
    
        await this.classifyAndRespond(message);
    }

    private async onSelfMessage(message: Message) {
        if (!message.fromMe) return;
        if (message.hasQuotedMsg && !Util.getModelByPrefix(message.body)) return;
        this.onMessage(message);
    }

    private formatProducts(products: any[]): string {
        return products.map(product => {
            return `Produto: ${product.nome}\nQuantidade: ${product.quantidade}\nPreço: ${product.preco}\nDescrição: ${product.descricao}\n`;
        }).join('\n');
    }

    private constructPromptWithProductContext(senderId: string, jsonInfo: string, msgStr: string): string {
        const productInfo = this.productContext[senderId];
        let productPrompt = '';
    
        if (productInfo) {
            productPrompt = `Informações do Produto Anterior:\n${this.formatProducts(productInfo)}\n\n`;
        }
    
        return `Abaixo temos informações do produto para consulta:${productPrompt} Abaixo as informações do banco: ${jsonInfo}\n\nPergunta: ${msgStr}`;
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

    public async sendMessage(msgStr: string, message: Message, modelName: string) {
        const model = this.aiModels.get(modelName as AiModels);
        if (model) {
            model.sendMessage(msgStr, message);
        } else {
            console.error('Modelo não encontrado:', modelName);
        }
    }
}

export { WhatsAppClient };
