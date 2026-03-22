module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { address } = req.body || {};
  if (!address) return res.status(400).json({ error: '주소를 입력해주세요' });

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'API 키가 설정되지 않았습니다' });

  // 주소에서 지역 추출
  const parts = address.split(' ');
  const sido = parts.slice(0, 2).join(' ');
  const dong = parts.slice(0, 3).join(' ');

  const prompt = `당신은 한국 부동산 건물 매물 전문 분석가입니다.

분석할 주소: ${address}

아래 순서대로 웹 검색을 실행하여 실제 데이터를 수집하세요:

1. "${address} 실거래가" 검색 → 국토부 실거래가, 네이버부동산, 직방 등에서 실거래 내역 수집
2. "${dong} 건물 매매 시세" 검색 → 해당 지역 건물 시세 파악
3. "${dong} 상가건물 임대료" 검색 → 시세 임대료 파악
4. "${sido} 개발호재 재개발 2024 2025" 검색 → 개발 계획 파악
5. "${dong} 상권 분석" 검색 → 주변 상권 특성 파악
6. "${address} 건축물대장" 또는 "${address} 준공연도" 검색 → 건물 기본 정보 파악

검색 결과를 최대한 활용하여 아래 JSON을 완성하세요.

절대 "정보 없음"이나 "확인 필요"로 두지 마세요.
검색으로 정확한 값을 못 찾았더라도 해당 지역 특성을 바탕으로 전문가로서 반드시 추정값을 제시하세요.
추정값은 "(추정)"을 붙여서 표기하세요. 예: "32억 (추정)"

마크다운 없이 순수 JSON만 반환:

{
  "소재지": "동/번지 형식 (예: 성내동 438-8)",
  "준공년도": "YYYY.MM 또는 YYYY년 (추정 가능)",
  "구조": "건물 구조 (예: 철근콘크리트 / 상가주택)",
  "용도지역": "용도지역 (예: 제2종근린생활시설, 제2종일반주거지역)",
  "연면적": "XX평 (XX㎡) (추정 가능)",
  "층수": "지상 N층 (지하 N층, 주차 N대 등) (추정 가능)",
  "접근성": "가장 가까운 역/버스정류장 도보시간, 대중교통 특성",
  "주변상권": "상권 특성, 주요 업종, 유동인구 배후세대 설명",
  "개발호재": "검색된 개발계획 또는 없음",
  "매매가": "XX억 (검색값 또는 추정값, 반드시 숫자로)",
  "평당단가": "XX만원 (매매가/연면적 계산 또는 추정)",
  "시세": "XX~XX억 (검색된 인근 시세 범위)",
  "가격판단": "적정 또는 고평가 또는 저평가",
  "최근실거래": "YYYY.MM / XX억 (검색값, 없으면 인근 유사 거래)",
  "거래량3년": "약 XX건 (검색값 또는 지역 추정치)",
  "비교사례": "인근 유사 건물 실거래 사례 (검색값 우선)",
  "임대구성": "층별 임대 현황 추정 (예: 1층 상가, 2-3층 사무실, 4-5층 주거)",
  "공실": "없음 또는 일부공실 또는 다수공실",
  "시세임대료": "보증금 XXXX만원 / 월 XXX만원 (검색값 또는 추정)",
  "근저당": "XX억 또는 없음 (등기 정보 없으면 추정)",
  "위반건축": "없음 또는 있음 (세움터 검색값, 없으면 없음으로 추정)",
  "외관변화": "변화 없음 또는 구체적 변화 내용",
  "투자요약": "검색 데이터 기반 2~3문장 투자 관점 요약",
  "리스크": "구체적 리스크 1~2가지",
  "기회": "구체적 투자 기회 또는 장점 1~2가지"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      return res.status(500).json({ error: err.error?.message || 'API 오류 ' + response.status });
    }

    const result = await response.json();

    // 웹서치 후 마지막 text 블록 추출
    let text = '';
    for (const b of (result.content || [])) {
      if (b.type === 'text') text = b.text;
    }
    if (!text) return res.status(500).json({ error: 'AI 응답이 비어있습니다' });

    const match = text.replace(/```json|```/g, '').trim().match(/\{[\s\S]*\}/);
    if (!match) return res.status(500).json({ error: '응답 파싱 실패: ' + text.slice(0, 200) });

    const data = JSON.parse(match[0]);
    return res.status(200).json({ success: true, data });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
