export const EMPTY_VISION_INSIGHT = Object.freeze({
  keywords: [],
  subjects: [],
  scene: '',
  mood: '',
  description: '',
  tags: [],
});

export const VISION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['keywords', 'subjects', 'scene', 'mood', 'description', 'tags'],
  properties: {
    keywords: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
    },
    subjects: {
      type: 'array',
      maxItems: 6,
      items: { type: 'string' },
    },
    scene: { type: 'string' },
    mood: { type: 'string' },
    description: { type: 'string' },
    tags: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
    },
  },
});

export function buildVisionPrompt(context = {}) {
  const place = cleanText(context.place) || '未知地点';
  const date = cleanText(context.date) || '未知日期';
  const keywords = cleanText(context.keywords) || '用户暂未提供关键词';

  return [
    '你是 Color Walk 拼贴编辑器的图片内容识别助手。',
    '请观察用户上传的图片，提取真实可见内容，而不是只根据颜色、日期或地点猜测。',
    '重点识别适合小红书文案复用的中文关键词，例如花、咖啡、建筑、街景、天空、店铺、人物、餐桌、展览、海边。',
    '也请给出主体、场景、氛围、一句自然描述和 3 到 8 个中文标签。',
    '避免编造不可见品牌、精确店名、人物身份或无法确认的地标。',
    '上下文：地点=' + place + '；日期=' + date + '；用户关键词=' + keywords + '。',
    '只输出符合 JSON schema 的结果。',
  ].join('\n');
}

export function buildVisionRequest({ model = 'gpt-5.5', images = [], context = {} } = {}) {
  const imageInputs = normalizeImages(images).map(function (image) {
    return {
      type: 'input_image',
      image_url: image.dataUrl,
    };
  });

  return {
    model,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: buildVisionPrompt(context) },
          ...imageInputs,
        ],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'color_walk_image_insight',
        strict: true,
        schema: VISION_SCHEMA,
      },
    },
  };
}

export function parseVisionResponse(response = {}) {
  const outputText = extractOutputText(response);
  if (!outputText) return emptyInsight();

  try {
    return normalizeVisionInsight(JSON.parse(outputText));
  } catch {
    return emptyInsight();
  }
}

export function normalizeVisionInsight(input = {}) {
  if (!input || typeof input !== 'object') return emptyInsight();

  return {
    keywords: normalizeTextList(input.keywords, 8),
    subjects: normalizeTextList(input.subjects, 6),
    scene: cleanText(input.scene).slice(0, 40),
    mood: cleanText(input.mood).slice(0, 32),
    description: cleanText(input.description).slice(0, 140),
    tags: normalizeTags(input.tags, 8),
  };
}

function normalizeImages(images) {
  return Array.isArray(images)
    ? images.filter(function (image) { return image && cleanText(image.dataUrl); }).slice(0, 4)
    : [];
}

function extractOutputText(response) {
  if (typeof response.output_text === 'string') return response.output_text.trim();
  if (!Array.isArray(response.output)) return '';

  for (const item of response.output) {
    if (!Array.isArray(item?.content)) continue;
    for (const content of item.content) {
      if (typeof content?.text === 'string') return content.text.trim();
      if (typeof content?.output_text === 'string') return content.output_text.trim();
    }
  }

  return '';
}

function normalizeTextList(value, limit) {
  if (!Array.isArray(value)) return [];
  return dedupe(value.map(cleanText).filter(Boolean)).slice(0, limit);
}

function normalizeTags(value, limit) {
  return normalizeTextList(value, limit).map(function (tag) {
    const cleaned = tag.replace(/^#+/, '').trim();
    return cleaned ? '#' + cleaned : '';
  }).filter(Boolean);
}

function dedupe(list) {
  return list.filter(function (value, index) {
    return list.indexOf(value) === index;
  });
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function emptyInsight() {
  return {
    keywords: [],
    subjects: [],
    scene: '',
    mood: '',
    description: '',
    tags: [],
  };
}
