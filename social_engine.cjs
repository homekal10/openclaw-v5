/**
 * social_engine.cjs
 * Generates social media content, hooks, and content calendars
 * using the local LM Studio AI — no paid APIs.
 */

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, 'telegram.env') });

const aiCore = require('./ai_core.cjs');

const PLATFORM_PROMPTS = {
    tiktok: {
        hook:     'Write 3 viral TikTok hooks (first 3 seconds) about: ',
        script:   'Write a 45-second TikTok video script with hook, value, and CTA about: ',
        calendar: 'Create a 7-day TikTok content calendar for someone in AI/automation. Include topic + angle per day.'
    },
    instagram: {
        hook:     'Write 3 Instagram carousel opening slides (bold text hooks) about: ',
        script:   'Write an Instagram caption with hook, value, and CTA for: ',
        calendar: 'Create a 7-day Instagram content calendar for an AI builder. Reels, carousels, stories mix.'
    },
    youtube: {
        hook:     'Write 3 YouTube thumbnail + title combinations optimized for CTR about: ',
        script:   'Write a 5-minute YouTube video outline with hook, sections, and CTA about: ',
        calendar: 'Create a 30-day YouTube content calendar targeting AI, trading, and automation topics.'
    },
    linkedin: {
        hook:     'Write 3 LinkedIn post opening lines (hooks) that stop the scroll about: ',
        script:   'Write a LinkedIn post with authority hook, story, insight, and CTA about: ',
        calendar: 'Create a 30-day LinkedIn content calendar for an AI systems builder establishing thought leadership.'
    }
};

function detectPlatform(query) {
    const q = query.toLowerCase();
    if (q.includes('tiktok'))    return 'tiktok';
    if (q.includes('instagram') || q.includes('insta')) return 'instagram';
    if (q.includes('youtube') || q.includes('yt'))      return 'youtube';
    if (q.includes('linkedin'))  return 'linkedin';
    return null;
}

function detectContentType(query) {
    const q = query.toLowerCase();
    if (q.includes('hook'))     return 'hook';
    if (q.includes('script'))   return 'script';
    if (q.includes('calendar')) return 'calendar';
    return 'script'; // default
}

async function generateContent(query) {
    const platform    = detectPlatform(query);
    const contentType = detectContentType(query);

    // Extract the topic from query
    const topic = query.replace(/(tiktok|instagram|youtube|linkedin|hook|script|calendar|grow|content|create|make|generate)/gi, '').trim() || 'AI systems and automation';

    let prompt;
    if (platform && PLATFORM_PROMPTS[platform]) {
        prompt = PLATFORM_PROMPTS[platform][contentType] + topic;
    } else {
        // Generic social media strategy
        prompt = `Create a social media content strategy for the topic: ${topic}. Include: platform recommendations, 3 content ideas, viral hooks, and growth tips.`;
    }

    // Add context
    const fullPrompt = `${prompt}

Context: This is for Kaleb Alemayehu, an AI Systems Builder & Startup Architect from Ethiopia. 
Target audience: tech founders, AI enthusiasts, and business-minded millennials.
Tone: Expert but approachable. Human, not corporate.
Focus: Value-first, authority-building content.`;

    const response = await aiCore.infer(fullPrompt, 'SOCIAL_MEDIA_MANAGER');
    return response;
}

async function generateContentCalendar(platform = 'all') {
    const prompt = platform === 'all'
        ? `Create a 30-day cross-platform content calendar for Kaleb Alemayehu (AI builder, startup architect).
           Include TikTok, Instagram, LinkedIn, YouTube. 
           Week 1: Build authority. Week 2: Showcase projects. Week 3: Educational content. Week 4: Personal brand.
           Format as a table with Day | Platform | Topic | Format | Goal.`
        : `Create a 30-day ${platform} content calendar for an AI systems builder.
           Mix of educational, inspirational, and promotional content.
           Format: Day | Topic | Format | Hook.`;

    return await aiCore.infer(prompt, 'SOCIAL_MEDIA_MANAGER');
}

module.exports = { generateContent, generateContentCalendar, detectPlatform };
