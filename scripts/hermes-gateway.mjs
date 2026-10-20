export function hermesSettings(environment = process.env) {
  const enabled = Boolean(environment.POLICYCOMPASS_HERMES_BASE_URL || environment.POLICYCOMPASS_HERMES_API_KEY);
  const apiKey = environment.POLICYCOMPASS_HERMES_API_KEY || '';
  let baseUrl = '';
  try {
    const url = new URL(environment.POLICYCOMPASS_HERMES_BASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error();
    baseUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch { /* A partial Hermes setup must not fall back to another provider. */ }
  const configured = enabled && Boolean(baseUrl) && /^[A-Za-z0-9_-]{32,512}$/.test(apiKey);
  return { enabled, configured, baseUrl, apiKey, model: 'hermes-agent',
    reason: configured ? '' : '서버의 Hermes HTTPS 주소와 전용 인증 키를 확인해 주세요.' };
}

export async function fetchHermesChat(body, { environment = process.env, fetchImpl = globalThis.fetch, signal } = {}) {
  const config = hermesSettings(environment);
  if (!config.configured) throw new Error(config.reason);
  return fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST', headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: config.model, stream: false, messages: body.messages,
      ...(body.response_format ? { response_format: body.response_format } : {}),
      ...(body.format && typeof body.format === 'object' ? { response_format: { type: 'json_schema', json_schema: { schema: body.format } } } : {}),
    }), redirect: 'error', signal,
  });
}

// Preserve the legacy graphs' request/response shape while changing only transport.
export async function configuredLocalChat(options, body) {
  const environment = options.environment ?? process.env;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 45_000);
  if (hermesSettings(environment).enabled) {
    const response = await fetchHermesChat(body, { environment, fetchImpl: options.fetchImpl, signal });
    if (!response.ok) return response;
    const result = await response.json();
    const choice = result?.choices?.[0];
    if (result?.error || result?.hermes?.completed === false || choice?.finish_reason !== 'stop' || typeof choice?.message?.content !== 'string') throw new Error('Hermes 응답이 정상 완료되지 않았습니다.');
    return new Response(JSON.stringify({ message: choice.message, model: 'hermes-agent', done: true, done_reason: 'stop', created_at: new Date().toISOString() }), { headers: { 'content-type': 'application/json' } });
  }
  const url = new URL(options.endpoint);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('로컬 AI는 이 기기의 Ollama만 사용할 수 있습니다.');
  return options.fetchImpl(`${url.origin}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal });
}
