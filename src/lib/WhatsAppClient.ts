import { Client, Message, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';

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

// utilities
import { Util } from '../util/Util';

// hooks
import { useSpinner } from '../hooks/useSpinner';
import { IModelConfig } from '../types/Config';
import { GeminiVisionModel } from '../models/GeminiVisionModel';

class WhatsAppClient {
    private client;
    private aiModels: Map<AiModels, AiModel<string>>;
    private customModel: CustomModel;
    private chatHistory: Map<string, string[]> = new Map();


    public constructor() {
        this.client = new Client({
            puppeteer: {
                args: ['--no-sandbox']
            },
            authStrategy: new LocalAuth() // Usando LocalAuth para gerenciamento da sessão
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
    
        // Certifique-se de que existe um histórico para o senderId
        if (!this.chatHistory.has(senderId)) {
            this.chatHistory.set(senderId, []);
        }
    
        // Adicione a mensagem ao histórico
        this.chatHistory.get(senderId)?.push(msgStr);
        

        if (msgStr.length == 0) return;
        
        const modelToUse = Util.getModelByPrefix(msgStr) as AiModels;

        // media
        if(message.hasMedia) {
            if (modelToUse === undefined || this.aiModels.get(modelToUse)?.modelType !== "Image") return;
            const model: IModelConfig = config.models[modelToUse] as IModelConfig;
            this.aiModels.get(modelToUse)?.sendMessage(msgStr.replace(model.prefix, ''), message);
            return;
        }

        // message without prefix
        if (modelToUse == undefined && !config.enablePrefix.enable) {
            this.sendMessage(msgStr, message, config.enablePrefix.defaultModel);
            return;
        }

        if (modelToUse == undefined) return; // no models added

        // message with prefix
        if (this.aiModels.get(modelToUse)) {
            const model: IModelConfig = config.models[modelToUse] as IModelConfig;
            this.aiModels.get(modelToUse)?.sendMessage(msgStr.replace(model.prefix, ''), message);
        } else {
            // use custom model
            this.customModel.sendMessage({ prompt: msgStr, modelName: modelToUse }, message);
        }
    }

    private async onSelfMessage(message: Message) {
        if (!message.fromMe) return;  
        if (message.hasQuotedMsg && !Util.getModelByPrefix(message.body)) return;
        this.onMessage(message);
    }

    public async sendMessage(msgStr: string, message: Message, modelName: string) {
        const senderId = message.from;
    
        // Use um fallback para uma string vazia se não existir histórico
        const history = this.chatHistory.get(senderId) || [];
        const fullPrompt = `${history.join('\n')}\n${msgStr}`;
    
        // Verifique se o modelo existe e use o fullPrompt
        if (this.aiModels.get(modelName as AiModels)) {
            const model: IModelConfig = config.models[modelName as AiModels] as IModelConfig;
            this.aiModels.get(modelName as AiModels)?.sendMessage(fullPrompt, message);
        } else {
            // Se for um modelo personalizado, ainda use o fullPrompt
            this.customModel.sendMessage({ prompt: fullPrompt, modelName }, message);
        }
    }
}

export { WhatsAppClient };

// DOCS:
// https://wwebjs.dev/guide/#qr-code-generation