import logger from '../../utils/logger';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy_key',
});

export const suggestHolidays = async (country: string) => {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant that suggests public holidays for a given country. Return ONLY a JSON array containing objects with keys: name, holidayDate (YYYY-MM-DD), isRecurring (boolean). Do not include any explanation or markdown tags.' },
        { role: 'user', content: `List important public holidays for ${country} in the current year.` }
      ],
    });
    
    const content = response.choices[0].message?.content || '[]';
    // try to strip markdown markers if present
    const cleaned = content.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    logger.error('Failed to get AI suggestions', err);
    return [];
  }
};
