import { Client, Message, LocalAuth } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
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



class WhatsAppClient {
    private client;
    private aiModels: Map<AiModels, AiModel<string>>;





    private searchByKeywords(data: any[], keywords: string[]): any[] {
        // Função para remover caracteres especiais e pontuações
        const removeSpecialChars = (text: string) => {
            return typeof text === 'string' ? text.replace(/[^\w\s]/gi, '') : text;
        };

        // Pré-processamento das palavras-chave: minúsculas e remoção de caracteres especiais
        const processedKeywords = keywords.map(keyword => removeSpecialChars(keyword.toLowerCase()));

        // Filtrar apenas as palavras-chave que têm comprimento significativo
        const significantKeywords = processedKeywords.filter(keyword => keyword.length > 2);

        return data.filter(item => {
            // Combine todas as informações do item em uma string para pesquisa, excluindo o 'ID'
            const itemInfo = Object.entries(item)
                .filter(([key]) => key.toLowerCase() !== 'id') // Exclui a coluna "ID" da pesquisa
                .map(([_, value]) => typeof value === 'string' ? removeSpecialChars(value).toLowerCase() : value)
                .join(' ');

            // Verifique se pelo menos uma das palavras-chave significativas está presente nas informações do item
            return significantKeywords.some(keyword => itemInfo.includes(keyword));
        });
    }


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

    private async classifyAndRespond(message: Message) {
        // Armazena a mensagem do cliente
        const clientMessage = message.body;

        // Constrói o prompt para o modelo Gemini
        const prompt = `Analise a mensagem recebida e classifique-a da seguinte maneira:\n\n
    Se a mensagem estiver relacionada à 'informações de produtos', responda com 'produto'.\n
    Se a mensagem estiver relacionada a 'Informações sobre a empresa' responda com 'empresa'.\n
    Se a mensagem estiver relacionada à 'troca de produtos ou defeitos', responda com 'troca'.\n
    Se a mensagem tratar de assuntos relacionados à 'pagamento' responda com 'pagamento'.\n
    Se a mensagem não se encaixar em nenhuma dessas categorias, responda com 'default'.\n\n
    mensagem: ${clientMessage}`;

        // Envia o prompt para o modelo Gemini e recebe a resposta
        const category = await this.sendPromptToGemini(prompt);

        // Registrar a categoria no console
        console.log('Categoria detectada:', category);

        let responsePrompt = '';

        switch (category) {
            case 'produto':
                // Seção para lidar com a categoria 'produto'
                let productInfo = await this.getJsonInfoFromAPI('http://localhost:3000/produtos');
                const keywords = message.body.toLowerCase().split(' '); // Divide a mensagem em palavras-chave
                const matchingProducts = this.searchByKeywords(JSON.parse(productInfo), keywords);

                if (matchingProducts.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações completas
                    const productInfoText = matchingProducts.map(product => {
                        // Formate cada objeto como uma string formatada
                        return `Informações do produto:\n${this.formatObjectToString(product)}`;
                    }).join('\n\n');

                    responsePrompt = `informações:\n${productInfoText}\n **quando for informação de produto que não esteja acima, significa que não temos no estoque** \n *utilize seus conhecimentos* quando não tiver informações fornecidas para responder,  \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;
            case 'pagamento':
                // Seção para lidar com a categoria 'pagamento'
                let paymentInfo = await this.getJsonInfoFromAPI('http://localhost:3000/pagamentos');
                const keywordsPayment = message.body.toLowerCase().split(' '); // Divide a mensagem em palavras-chave
                const matchingPayments = this.searchByKeywords(JSON.parse(paymentInfo), keywordsPayment);

                if (matchingPayments.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações completas
                    const paymentInfoText = matchingPayments.map(payment => {
                        // Formate cada objeto como uma string formatada
                        return `Informações de pagamento:\n${this.formatObjectToString(payment)}`;
                    }).join('\n\n');

                    responsePrompt = `informações:\n${paymentInfoText}\n\n *utilize seus conhecimentos* quando não tiver informações fornecidas para responder, \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;
            case 'empresa':
                // Seção para lidar com a categoria 'pagamento'
                let empresaInfo = await this.getJsonInfoFromAPI('http://localhost:3000/empresa');
                const keywordsEmpresa = message.body.toLowerCase().split(' '); // Divide a mensagem em palavras-chave
                const matchingEmpresa = this.searchByKeywords(JSON.parse(empresaInfo), keywordsEmpresa);

                if (matchingEmpresa.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações completas
                    const empresaInfoText = matchingEmpresa.map(empresa => {
                        // Formate cada objeto como uma string formatada
                        return `Informações de pagamento:\n${this.formatObjectToString(empresa)}`;
                    }).join('\n\n');

                    responsePrompt = `informações:\n${empresaInfoText}\n\n *utilize seus conhecimentos* quando não tiver informações fornecidas para responder, \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;
            default:
                // Caso padrão: categoria não reconhecida, use o prompt padrão com a mensagem do cliente
                responsePrompt = `Responda a pergunta abaixo:\n\n${message.body}`;
                break;
        }

        // Enviar a resposta com base no prompt definido
        this.sendMessage(responsePrompt, message, config.enablePrefix.defaultModel);
    }



    private async sendPromptToGemini(prompt: string): Promise<string> {
        const model = this.aiModels.get('Gemini');

        if (model && model instanceof GeminiModel) {
            try {
                // Chame o método generateResponse com o prompt
                const response = await model.generateResponse(prompt);

                // O 'response' deve conter a categoria detectada pelo modelo Gemini
                return response;
            } catch (error) {
                console.error('Erro ao processar o prompt com GeminiModel:', error);
                return 'default';
            }
        } else {
            console.error('Modelo Gemini não encontrado ou não é do tipo correto');
            return 'default';
        }
    }

    // Função para formatar um objeto como uma string formatada
    private formatObjectToString(obj: Record<string, string>) {
        let result = '';
        for (const key in obj) {
            if (Object.hasOwnProperty.call(obj, key) && key !== 'id') { // Adicione a condição para ignorar a coluna "ID"
                result += `${key}: ${obj[key]}\n`;
            }
        }
        return result;
    }



    private async onMessage(message: Message) {
        
        // Classifique e responda a mensagem
        await this.classifyAndRespond(message);
    }

    private async onSelfMessage(message: Message) {
        if (!message.fromMe) return;
        if (message.hasQuotedMsg && !Util.getModelByPrefix(message.body)) return;
        this.onMessage(message);
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
