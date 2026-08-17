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

  // 🔒 톤별 이모지 상한선 강제 제어
  const EMOJI_LIMIT = { plain: 0, cute:3, funny: 4, touching: 1 };

  function enforceEmojiLimit(text, limit) {
    if (!text) return text;
    const emojiRegex = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/gu;
    let count = 0;
    let cleaned = text.replace(emojiRegex, (match) => {
      count++;
      return count <= limit ? match : '';
    });
    cleaned = cleaned.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    return cleaned;
  }

  // 🔒 한자/일본어/힌디어/아랍어/영어만 제거하고 한글+이모지는 100% 보존
  function normalizeKoreanOnly(text) {
    if (!text) return '';
    return text
      .replace(/[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u30FF\u0600-\u06FF\u0900-\u097F]/g, ' ')
      .replace(/[A-Za-z]/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  if (!API_KEY) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'GROQ_API_KEY 환경변수가 설정되지 않았습니다.' })
    };
  }

  const GIFT_SYSTEM = `당신은 대한민국 전 연령대 맞춤 생일 선물 큐레이터 AI입니다.
반드시 제공된 [후보 상품 목록] 중에서만 골라야 합니다.
[절대 규칙]
1. name, price, icon은 후보 목록에 있는 값을 절대 바꾸지 말고 그대로 사용하세요.
2. 반드시 후보 목록에 있는 상품 중에서만 3개를 선택하세요.
3. desc(추천 이유)만 받는 분의 상황에 맞게 센스 있고 매력적인 한 줄로 새로 작성하세요.
4. 부가 설명 없이 반드시 순수 JSON 배열 포맷만 출력하세요:
[{"name":"상품명 그대로","price":가격 그대로,"icon":"아이콘 그대로","desc":"추천 이유"}]`;

  const MESSAGE_SYSTEM = `당신은 센스 있는 한국어 생일 축하 메시지 작가입니다.

[절대 규칙]
1. 한자(漢字), 일본어, 중국어, 힌디어, 아랍어, 영어 등 외국어는 절대 사용하지 마세요.
2. [전달자: 나 / 수신자: 상대방] 관계입니다. 사용자가 입력한 요청사항은 '내가 상대방에게 건네는 응원/축하 말'입니다. "상대방이 나에게 해줘서 고맙다"는 식으로 주어와 목적어를 절대 반대로 바꾸지 마세요.
3. 사용자가 '~해줘', '~라고 해줘'라고 입력하면, 그 내용을 내가 상대방에게 직접 건네는 다정한 응원의 문장으로 자연스럽게 전환하세요.
4. 관계는 문장의 격식만 결정할 뿐, 사용자가 실제로 취업/승진/이직 등을 했다는 사실을 추측해 말하지 마세요. '선배/직장동료'라고 골라도 실제 이벤트를 상상해서는 안 됩니다.
5. 사용자가 요청한 톤과 분량을 반드시 지키세요. '유쾌하게'는 밝고 가볍게, '보통 분량'은 2~3문장, '짧게'는 1~2문장입니다.
6. 이모지는 톤에 맞게 1~2개만 자연스럽게 사용하고, plain 톤은 이모지 없이 작성하세요.
7. 반드시 완성문 1개만 출력하고, 설명 문구나 선택지, 숫자 리스트, 추가 문장은 넣지 마세요.`;

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
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_INSTRUCTION },
          { role: 'user', content: userPrompt }
        ],
        temperature: mode === 'gift' ? 0.1 : 0.5,
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
      text = normalizeKoreanOnly(text);
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