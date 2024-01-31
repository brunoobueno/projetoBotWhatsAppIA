import { Client, Message, LocalAuth, MessageId } from 'whatsapp-web.js';
import QRCode from 'qrcode-terminal';
import axios from 'axios';
import dotenv from 'dotenv';


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

    // Propriedade de instância para armazenar as informações de produtos do usuário dinamicamente
    private userProductInfoMap: Map<string, string> = new Map<string, string>();

    //função que armazena o histórico para cada cliente
    private messageHistory: Map<string, string[]> = new Map();

    private addToMessageHistory(phoneNumber: string, message: string) {
        // Obtém o histórico existente ou cria um novo array se não existir
        let history = this.messageHistory.get(phoneNumber) || [];

        // Adiciona a nova mensagem ao histórico
        history.push(message);

        // Limita o histórico a no máximo 2 mensagens
        if (history.length > 2) {
            history = history.slice(-2); // Mantém apenas as últimas duas mensagens
        }

        // Se o histórico estava vazio, adicione mensagens padrão
        if (history.length === 1 && history[0] === message) {
            history.unshift('oi', 'olá'); // Adiciona mensagens padrão no início do histórico
        }

        // Atualiza o histórico no mapa
        this.messageHistory.set(phoneNumber, history);
    }

    // Adicionando uma fila de execução para as mensagens
    private messageQueue: Message[] = [];
    private isProcessingQueue: boolean = false;

    // Função para enfileirar mensagens
    private enqueueMessage(message: Message) {
        this.messageQueue.push(message);
        if (!this.isProcessingQueue) {
            this.processMessageQueue();
        }
    }

    // Função para processar a fila de mensagens
    private async processMessageQueue() {
        this.isProcessingQueue = true;

        while (this.messageQueue.length > 0) {
            const message = this.messageQueue.shift()!;
            await this.classifyAndRespond(message);
        }

        this.isProcessingQueue = false;
    }



    // Função para realizar a pesquisa de palavras no banco de dados da API
    private searchByKeywords(data: any[], keywords: string[]): any[] {
        // Função para remover caracteres especiais e pontuações
        const removeSpecialChars = (text: string) => {
            return typeof text === 'string' ? text.replace(/[^\w\s]/gi, '') : text;
        };

        // Lista de stop words (palavras que queremos excluir da pesquisa)
        const stopWords = ['qual', 'quais', 'para', 'tem', 'isso', 'isto', 'logo', 'cedo', 'tarde', 'cedinho', 'depois', 'antes', 'durante',
            'enquanto', 'imediatamente', 'aqui', 'acola', 'nesta', 'naquela', 'nestas', 'naquelas', 'toda', 'todas',
            'todo', 'todos', 'muita', 'muitas', 'muito', 'muitos', 'alguma', 'algumas', 'algum', 'alguns', 'pouca', 'poucas',
            'pouco', 'poucos', 'certa', 'certas', 'certo', 'certos', 'outra', 'outras', 'outro', 'outros', 'mesma', 'mesmas',
            'mesmo', 'mesmos', 'vários', 'várias', 'varias', 'varios', 'quaisquer', 'nenhuma', 'nenhumas', 'nenhum', 'nenhuns',
            'outro', 'outra', 'outros', 'outras', 'tal', 'tais', 'uma', 'uns', 'umas', 'cada', 'algum', 'alguma', 'alguns',
            'algumas', 'certo', 'certa', 'certos', 'certas', 'ante', 'até', 'após', 'com', 'contra', 'de', 'desde', 'em', 'entre',
            'para', 'perante', 'por', 'sem', 'sob', 'sobre', 'trás', 'produto', 'produtos']; // Adicione outras stop words conforme necessário

        // Pré-processamento das palavras-chave: minúsculas, remoção de caracteres especiais e remoção de stop words
        const processedKeywords = keywords
            .map(keyword => removeSpecialChars(keyword.toLowerCase()))
            .filter(keyword => keyword.length > 2 && !stopWords.includes(keyword));

        // Lista para armazenar as informações dos produtos correspondentes
        const matchingProductsInfo: any[] = [];
        let totalLength = 0;

        data.forEach(item => {
            // Combine todas as informações do item em uma string para pesquisa, excluindo o 'ID'
            const itemInfo = Object.entries(item)
                .filter(([key]) => key.toLowerCase() !== 'codigo'.toLowerCase())
                .map(([_, value]) => typeof value === 'string' ? removeSpecialChars(value).toLowerCase() : value)
                .join(' ');

            // Verifique se pelo menos uma das palavras-chave exatas está presente no texto completo
            const atLeastOneKeywordMatch = processedKeywords.some(keyword => {
                const exactKeyword = removeSpecialChars(keyword);
                const regex = new RegExp(`\\b${exactKeyword}\\b`, 'i');
                return regex.test(itemInfo);
            });

            // Se pelo menos uma palavra-chave tiver correspondência, e o comprimento total permitido não for excedido
            if (atLeastOneKeywordMatch && itemInfo.trim() !== '' && totalLength + itemInfo.length <= 2000) {
                matchingProductsInfo.push(item);
                totalLength += itemInfo.length;
            }
        });

        return matchingProductsInfo;
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
    Se a mensagem estiver relacionada à 'informações de produto', responda com 'produto'.\n
    Se a mensagem estiver relacionada a 'Informações sobre a empresa, como numero de telefone ou endereço' responda com 'empresa'.\n
    Se a mensagem estiver relacionada à 'Informações de pagamento' responda com 'pagamento'.\n
    Se a mensagem estiver relacionada à 'entrega ou envio de produtos' responda com 'entrega'.\n
    Se a mensagem estiver relacionada à 'saudação inicial / perguntas sobre quem é você' responda com 'saudacao'.\n
    Se a mensagem estiver relacionada à 'promoções, cupons e descontos' responda com 'promocao'.\n
    se a mensagem estiver relacioanda à 'informações de troca/garantia/defeitos de produtos', responda com 'troca'.\n
    se a mensagem estiver relacioanda à 'informações para realizar um pedido', responda com 'pedido'.\n
    Se a mensagem estiver relacioanda à 'frases de despedida' responda com 'default'.\n
    Se a mensagem não se encaixar em nenhuma dessas categorias, responda com 'default'.\n\n
    mensagem: ${clientMessage}`;

        // Envia o prompt para o modelo Gemini e recebe a resposta
        const category = await this.sendPromptToGemini(prompt);

        // Registrar a categoria no console
        console.log('Categoria detectada:', category);

        //registra o histórico do cliente no console
        console.log('Histórico atual:', JSON.stringify(this.messageHistory.get(message.from)))

        let responsePrompt = '';
        //variavel do Contexto

        switch (category) {

            case 'produto':
                // Seção para lidar com a categoria 'produto'
                const productEndpoint = 'http://localhost:3000/produtos';
                const productInfo = await this.getJsonInfoFromAPI(productEndpoint);
                const rawProductInfo = JSON.parse(productInfo);

                // Chama a função searchByKeywords para processar as informações
                const keywords = message.body.toLowerCase().split(' ');
                const ResultadoPesquisa = this.searchByKeywords(rawProductInfo, keywords);

                if (ResultadoPesquisa.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações formatadas
                    const productInfoText = ResultadoPesquisa.map(product => {
                        // Formate cada objeto como uma string formatada
                        return `${this.formatObjectToString(product)}`;
                    }).join('\n\n');

                    // Atualize userProductInfoMap associado ao número de telefone do usuário
                    this.userProductInfoMap.set(message.from, productInfoText);

                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n\n  informações adicionais:\n\n${productInfoText}\n\n ***se o pruduto não estiver na lista a cima, responda que não trabalhamos com esse produto***\n\n ***se for mais de 1 produto, responda a pergunta para cada produto***\n\n *utilize seus próprios conhecimentos* quando não tiver informações fornecidas para responder, **se for mencionar dados acima, realiza uma formatação antes**\n\n agora responda: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria, uma loja de produtos de limpeza (não precisa se apresentar)*\n\n  histórico da conversa: ${JSON.stringify(this.messageHistory.get(message.from))}\n\n informações adicionais sobre produtos anteriores:${this.userProductInfoMap.get(message.from)}\n\n ***se o pruduto não estiver na lista a cima, responda que não trabalhamos com esse produto*** \n\nagora responda: ${message.body}`;
                }
                break;

            case 'pagamento':
                // Seção para lidar com a categoria 'pagamento'
                let paymentInfo = await this.getJsonInfoFromAPI('http://localhost:3000/pagamentos');

                if (paymentInfo.length > 0) {


                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n informações:\n${paymentInfo}\n\n *utilize seus conhecimentos* quando não tiver informações fornecidas para responder, \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            case 'empresa':
                // Seção para lidar com a categoria 'pagamento'
                let empresaInfo = await this.getJsonInfoFromAPI('http://localhost:3000/empresa');


                if (empresaInfo.length > 0) {


                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n informações:\n${empresaInfo}\n\n *utilize seus conhecimentos* quando não tiver informações fornecidas para responder, \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            case 'saudacao':
                // Seção para lidar com a categoria 'pagamento'
                let saudacaoInfo = await this.getJsonInfoFromAPI('http://localhost:3000/saudacao');

                responsePrompt = `finja que você trabalha na alquimia industria (loja de produtos de limpeza) as informações abaixo são suas\n Informações: ${saudacaoInfo} \n*utilize seus conhecimentos* quando não tiver informações fornecidas para responder, \nSe apresente e não dê respostas muito longas; \n\nMensagem: ${message.body};                    ; `;
                break;

            case 'troca':
                // Seção para lidar com a categoria 'troca'
                let exchangeInfo = await this.getJsonInfoFromAPI('http://localhost:3000/troca');

                if (exchangeInfo.length > 0) {

                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Informações:\n${exchangeInfo}\n\n dessa lista encontre qual se adequa mais com a pergunta e responda com base nas informações.\n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            case 'entrega':
                // Seção para lidar com a categoria 'entrada'
                let deliveryInfo = await this.getJsonInfoFromAPI('http://localhost:3000/entrega');

                if (deliveryInfo.length > 0) {

                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Informações:\n${deliveryInfo}\n\nDessa lista, encontre qual se adequa mais com a pergunta e responda com base nas informações. *Utilize seus conhecimentos* quando não tiver informações fornecidas para responder.\n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            case 'promocao':
                // Seção para lidar com a categoria 'troca'
                let promocaoInfo = await this.getJsonInfoFromAPI('http://localhost:3000/promocao');


                if (promocaoInfo.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações completas

                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Informações:\n${promocaoInfo}\n\n com base nas informações acima, responda a mensagem abaixo: \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            case 'pedido':
                // Seção para lidar com a categoria 'troca'
                let compraInfo = await this.getJsonInfoFromAPI('http://localhost:3000/pedido');


                if (compraInfo.length > 0) {
                    // Se houver resultados da pesquisa, crie o prompt com as informações completas

                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Informações:\n${compraInfo}\n\n com base nas informações acima, responda a mensagem abaixo direcionando o cliente para o setor de compras: \n\nMensagem: ${message.body}`;
                } else {
                    // Se não houver resultados da pesquisa, use um prompt padrão
                    responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n Responda a pergunta abaixo:\n\n${message.body}`;
                }
                break;

            default:
                // Caso padrão: categoria não reconhecida, use o prompt padrão com a mensagem do cliente
                responsePrompt = `*finja que você trabalha na alquimia industria (não precisa se apresentar)*\n\n Responda a mensagem abaixo\n\n
                mensagem: ${message.body}`;
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
            if (Object.hasOwnProperty.call(obj, key) && key !== 'codigo') { // Adicione a condição para ignorar a coluna "ID"
                result += `${key}: ${obj[key]}\n`;
            }
        }
        return result;
    }



    private async onMessage(message: Message) {
        if (!message.fromMe && message.body.trim() !== '') {
            // Adiciona a mensagem ao histórico do cliente
            this.addToMessageHistory(message.from, message.body);

            // envie a mensagem para a fila de espera
            this.enqueueMessage(message);
        }
    }


    private async onSelfMessage(message: Message) {
        if (!message.fromMe) return;
        if (message.hasQuotedMsg && !Util.getModelByPrefix(message.body)) return;
        this.enqueueMessage(message);
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
