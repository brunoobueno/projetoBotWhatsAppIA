/* Models config files */
import { Config } from './types/Config';

const config: Config = {
    chatGPTModel: "gpt-3.5-turbo",
    models: {
        ChatGPT: {
            prefix: '!chatgpt',
            enable: true
        },
        DALLE: {
            prefix: '!dalle',
            enable: true
        },
        StableDiffusion: {
            prefix: '!stable',
            enable: true
        },
        GeminiVision: {
            prefix: '!gemini-vision',
            enable: true
        },
        Gemini: {
            prefix: '!chat',
            enable: true
        },
        Custom: [
            {
                modelName: 'whatsapp-ai-bot',
                prefix: '!bot',
                enable: true,
                context: './static/whatsapp-ai-bot.md',
            }
        ]
    },
    enablePrefix: {
        enable: false, // Desativado para que qualquer mensagem acione o modelo padrão
        defaultModel: 'Gemini' // Modelo padrão agora é Gemini
    }
};

export default config;
