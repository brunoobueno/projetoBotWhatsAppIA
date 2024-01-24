import { Client, Message, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';
import axios from 'axios';

// config file
import config from '../whatsapp-ai.config';

// base types
import { AiModels } from '../types/AiModels';
import { AiModel } from '../models/AiModel';

// extends from base
import { ChatGptModel } from '../models/ChatGptModel';
import { StabilityModel } from '../models/StabilityModel';
import { DalleModel } from '../models/DalleModel';
import { CustomModel } from '../models/CustomModel';
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
    private customModel: CustomModel;
    private chatHistory: Map<string, string[]> = new Map();
    private productContext: { [key: string]: any } = {}; // Contexto de produto por ID do remetente

    public constructor() {
        this.client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            },
            authStrategy: new LocalAuth()
        });

        this.aiModels = new Map<AiModels, AiModel<string>>();
        // init models
        this.aiModels.set('ChatGPT', new ChatGptModel());
        this.aiModels.set('DALLE', new DalleModel());
        this.aiModels.set('StableDiffusion', new StabilityModel());
        this.aiModels.set('Gemini', new GeminiModel());
        this.aiModels.set('GeminiVision', new GeminiVisionModel());
        
        this.customModel = new CustomModel();
    }

    public initializeClient() {
        this.subscribeEvents();
        this.client.initialize();
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

        if (!this.chatHistory.has(senderId)) {
            this.chatHistory.set(senderId, []);
        }
        
        let currentHistory = this.chatHistory.get(senderId);
        if (!currentHistory) {
            currentHistory = [];
            this.chatHistory.set(senderId, currentHistory);
        }

        if (currentHistory && currentHistory.length >= 10) {
            currentHistory.shift();
        }

        currentHistory?.push(msgStr);
    
        if (msgStr.length == 0) return;

        // Extraia a palavra-chave e atualize o contexto
        const jsonInfo = await this.extractKeyword(msgStr, senderId) || 'Não foram encontradas informações relevantes.';

        // Construa o prompt com informações do contexto
        const fullPrompt = this.constructPromptWithProductContext(senderId, jsonInfo, msgStr);
    
        const modelToUse = Util.getModelByPrefix(msgStr) as AiModels;

        if (message.hasMedia) {
            if (modelToUse === undefined || this.aiModels.get(modelToUse)?.modelType !== "Image") return;
            const model: IModelConfig = config.models[modelToUse] as IModelConfig;
            this.aiModels.get(modelToUse)?.sendMessage(msgStr.replace(model.prefix, ''), message);
            return;
        }

        if (modelToUse == undefined && !config.enablePrefix.enable) {
            this.sendMessage(fullPrompt, message, config.enablePrefix.defaultModel);
            return;
        }

        if (modelToUse == undefined) return;

        if (this.aiModels.get(modelToUse)) {
            const model: IModelConfig = config.models[modelToUse] as IModelConfig;
            this.aiModels.get(modelToUse)?.sendMessage(fullPrompt, message);
        } else {
            this.customModel.sendMessage({ prompt: fullPrompt, modelName: modelToUse }, message);
        }
    }

    private async extractKeyword(message: string, senderId: string): Promise<string | null> {
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
    
        // Se não houve correspondência com as palavras-chave, use o simplePrompt
        if (jsonInfo === null) {
            const history = this.chatHistory.get(senderId) || [];
            const historyString = history.join('\n');
            jsonInfo = `Responda apenas a informação abaixo:\n${message}`;
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
    
        return `Abaixo temos informações do produto para consulta:${productPrompt}Abaixo as informações do Banco de dados para responder essa pergunta:\n${jsonInfo}\n\nPergunta: ${msgStr}`;
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

        const fullPrompt = `*desconsidere o histórico caso não tenha informação do histórico da conversa. \nAqui tem o histórico da nossa conversa, use apenas para consulta caso precise:\n${historyString}\n\nResponda apenas a informação abaixo:\n${msgStr}`;
    
        if (this.aiModels.get(modelName as AiModels)) {
            const model: IModelConfig = config.models[modelName as AiModels] as IModelConfig;
            this.aiModels.get(modelName as AiModels)?.sendMessage(fullPrompt, message);
        } else {
            this.customModel.sendMessage({ prompt: fullPrompt, modelName }, message);
        }
    }
}

export { WhatsAppClient };
