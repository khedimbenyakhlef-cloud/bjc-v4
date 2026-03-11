'use strict';

const axios = require('axios');
const logger = require('../utils/logger');

class AIService {
  static async generate(prompt, userId) {
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('Service IA non configuré (clé API manquante)');
    }

    try {
      const response = await axios.post(
        'https://api.deepseek.com/v1/chat/completions',
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: 'Tu es un assistant expert en développement web. Génère du HTML/CSS/JS propre et moderne.',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          max_tokens: 4000,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json',
          },
          timeout: 45_000,
        }
      );

      logger.info('IA generate réussi', { userId, promptLength: prompt.length });
      return response.data.choices[0].message.content;
    } catch (err) {
      if (err.response?.status === 429) {
        throw new Error('Quota IA dépassé, réessayez plus tard');
      }
      if (err.code === 'ECONNABORTED') {
        throw new Error('Le service IA a mis trop de temps à répondre');
      }
      logger.error('Erreur API DeepSeek', { error: err.message, userId });
      throw new Error('Service IA temporairement indisponible');
    }
  }
}

module.exports = AIService;
