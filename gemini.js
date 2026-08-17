exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { body = {}; }

  const mode = body.mode || 'message';
  let userPrompt = body.prompt || '';
  const candidates = body.candidates || [];
  const tone = body.tone || 'plain';
  const API_KEY = process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.trim() : null;

  const EMOJI_LIMIT = { plain: 0, cute: 3, funny: 4, touching: 1 };

  function enforceEmojiLimit(text, limit) {
    if (!text) return text;
    if (limit === 0) {
      return text.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu, '').replace(/[ \t]{2,}/g, ' ').trim();
    }
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
    let count = 0;
    let cleaned = text.replace(emojiRegex, (match) => {
      count++;
      return count <= limit ? match : '';
    });
    return cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GROQ_API_KEY 환경변수가 설정되지 않았습니다.' })
    };
  }

  const GIFT_SYSTEM = `당신은 대한민국 맞춤 생일 선물 큐레이터 AI입니다.
반드시 제공된 [후보 상품 목록] 안에서만 3개를 골라야 합니다.
1. name, price, icon은 후보 목록의 값을 그대로 유지하세요.
2. desc(추천 이유)만 한 줄로 매력적으로 작성하세요.
3. 부가 설명 없이 순수 JSON 배열만 반환하세요:
[{"name":"상품명","price":000,"icon":"이모지","desc":"추천이유"}]`;

  const MESSAGE_SYSTEM = `당신은 센스 있는 한국인 친구처럼 자연스럽고 다정한 생일 축하 카카오톡 메시지를 작성해주는 AI입니다.

[작성 지침]
1. 사용자가 전달한 핵심 내용/응원/추억이 있다면, "~하라고 해줘" 같은 요청 형태를 절대 그대로 쓰지 말고 "내가 상대방에게 직접 다정하게 건네는 응원과 덕담"으로 100% 매끄럽게 녹여내세요.
2. 딱딱하거나 어색한 번역투, 기계적인 문장을 쓰지 말고 실생활에서 사용하는 자연스러운 한국어 구어체로 작성하세요.
3. 요청한 관계(친구/가족/선배), 말투(반말/존댓말), 톤앤매너, 분량을 철저히 준수하세요.
4. plain 톤은 이모지를 쓰지 말고 담백하게, cute/funny/touching 톤은 상황에 맞는 이모지를 자연스럽게 1~2개 섞으세요.
5. 설명문이나 따옴표 없이 완성된 축하 메시지 텍스트만 바로 출력하세요.`;

  const SYSTEM_INSTRUCTION = mode === 'gift' ? GIFT_SYSTEM : MESSAGE_SYSTEM;

  if (mode === 'gift' && candidates.length > 0) {
    userPrompt += `\n\n[후보 상품 목록]\n${JSON.stringify(candidates)}\n\n위 후보 목록 안에서만 가장 어울리는 상품 3개를 선정해 지정된 JSON 배열로만 출력하세요.`;
  }

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: 'qwen/qwen3.6-27b',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: userPrompt }
        ],
        temperature: mode === 'gift' ? 0.1 : 0.6,
        max_tokens: 800
      })
    });

    const data = await resp.json();

    if (!resp.ok) {
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({ error: data?.error?.message || 'Groq API 오류 발생', raw: data })
      };
    }

    let text = data?.choices?.[0]?.message?.content || null;
    if (text && mode === 'message') {
      text = text.replace(/^["']|["']$/g, '').trim();
      const limit = EMOJI_LIMIT[tone] !== undefined ? EMOJI_LIMIT[tone] : 2;
      text = enforceEmojiLimit(text, limit);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text, raw: data, error: null })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
