import type { VisitorLocale } from '../../../i18n/visitorMessages';
import type { SoundMapEntry } from '../../../storage/soundMapRepository';

const ja = {
  connections: 'テーマのつながり',
  memory: '{date}、ある参加者が残した「{topic}」の思い出', memoryNoDate: 'ある参加者が残した「{topic}」の思い出',
  title: '福岡の声', subtitle: '街に重なる、わたしたちの記憶。', count: '件の声',
  before: 'みんなの声を聞く', after: '声の地図を見に行く', more: 'ほかの声を聞く',
  back: '戻る', leave: '自分の声を残す', close: '閉じる', list: '声の一覧', map: '地図',
  loading: '声を読み込んでいます…', loadingAudio: '音声を読み込んでいます…',
  failed: '声を読み込めませんでした。', retry: '再読み込み', empty: 'まだ声がありません。',
  unavailable: 'この声は現在再生できません。', unlocated: '場所の登録なし', unresolved: '場所を表示できません',
  resolving: '場所を確認しています…', group: 'この場所の声', seconds: '秒',
  zoomIn: '拡大', zoomOut: '縮小', rotate: '回転', reset: '全体に戻る',
  food: '食', travel: '旅', encounter: '出会い', other: 'その他', unknown: '声',
  saved: 'あなたの声を、福岡に残しました。', savedHelp: '声の地図で、ほかの人の記憶にも出会ってみませんか。',
  physical: '実物の地図がある会場では、カードを地図に置くこともできます。',
  published: '送信した音声と選んだ場所は、オンラインの声の地図とこのタグから誰でも聞くことができます。',
  fallback: '3D 地図を表示できません。声の一覧からお聞きください。', externalPlace: '場所を Google Maps で見る',
};
export type SoundMapCopy = typeof ja;
export const soundMapMessages: Record<VisitorLocale, SoundMapCopy> = {
  'ja-JP': ja,
  'zh-CN': {
    connections: '主题连线',
    memory: '某位参与者于{date}留下的关于{topic}的留言', memoryNoDate: '某位参与者留下的关于{topic}的留言',
    title: '福冈的声音', subtitle: '留在街头，属于我们的记忆。', count: '段声音', before: '先听听大家的声音', after: '去声音地图看看', more: '听听其他声音',
    back: '返回', leave: '留下我的声音', close: '关闭', list: '声音列表', map: '地图', loading: '正在加载声音…', loadingAudio: '正在加载音频…',
    failed: '暂时无法加载声音。', retry: '重新加载', empty: '还没有声音。', unavailable: '这段声音暂时无法播放。', unlocated: '未选择地点', unresolved: '暂时无法显示地点',
    resolving: '正在确认地点…', group: '这里的声音', seconds: '秒', zoomIn: '放大', zoomOut: '缩小', rotate: '旋转', reset: '回到全图',
    food: '美食', travel: '旅行', encounter: '相遇', other: '其他', unknown: '声音', saved: '你的声音，已留在福冈。', savedHelp: '去声音地图，听听其他人留下的记忆吧。',
    physical: '如果现场有实体地图，也可以把卡片放在地图上。', published: '提交后，任何人都可以通过在线声音地图或这枚展签收听你的声音，并看到所选地点。',
    fallback: '暂时无法显示 3D 地图，仍可从声音列表收听。', externalPlace: '在 Google Maps 查看地点',
  },
  'zh-TW': {
    connections: '主題連線',
    memory: '某位參與者於{date}留下的關於{topic}的留言', memoryNoDate: '某位參與者留下的關於{topic}的留言',
    title: '福岡的聲音', subtitle: '留在街頭，屬於我們的記憶。', count: '段聲音', before: '先聽聽大家的聲音', after: '去聲音地圖看看', more: '聽聽其他聲音',
    back: '返回', leave: '留下我的聲音', close: '關閉', list: '聲音列表', map: '地圖', loading: '正在載入聲音…', loadingAudio: '正在載入音訊…',
    failed: '暫時無法載入聲音。', retry: '重新載入', empty: '還沒有聲音。', unavailable: '這段聲音暫時無法播放。', unlocated: '未選擇地點', unresolved: '暫時無法顯示地點',
    resolving: '正在確認地點…', group: '這裡的聲音', seconds: '秒', zoomIn: '放大', zoomOut: '縮小', rotate: '旋轉', reset: '回到全圖',
    food: '美食', travel: '旅行', encounter: '相遇', other: '其他', unknown: '聲音', saved: '你的聲音，已留在福岡。', savedHelp: '去聲音地圖，聽聽其他人留下的記憶吧。',
    physical: '如果現場有實體地圖，也可以把卡片放在地圖上。', published: '提交後，任何人都可以透過線上聲音地圖或這枚展籤收聽你的聲音，並看到所選地點。',
    fallback: '暫時無法顯示 3D 地圖，仍可從聲音列表收聽。', externalPlace: '在 Google Maps 查看地點',
  },
  en: {
    connections: 'Theme connections',
    memory: 'A participant’s memory about {topic}, shared on {date}', memoryNoDate: 'A participant’s memory about {topic}',
    title: 'Voices of Fukuoka', subtitle: 'Our memories, layered across the city.', count: 'voices', before: 'Listen to others first', after: 'Explore the sound map', more: 'Discover more voices',
    back: 'Back', leave: 'Leave my voice', close: 'Close', list: 'Voices', map: 'Map', loading: 'Loading voices…', loadingAudio: 'Loading audio…',
    failed: 'Unable to load voices.', retry: 'Try again', empty: 'No voices yet.', unavailable: 'This voice is currently unavailable.', unlocated: 'No place selected', unresolved: 'Place unavailable',
    resolving: 'Finding places…', group: 'Voices at this place', seconds: 'sec', zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate', reset: 'Reset view',
    food: 'Food', travel: 'Travel', encounter: 'Encounters', other: 'Other', unknown: 'Voice', saved: 'Your voice is now part of Fukuoka.', savedHelp: 'Explore the sound map and discover memories left by others.',
    physical: 'At a venue with a physical map, you can also place your card on it.', published: 'Anyone can hear your voice and see your selected place through the online sound map or this tag after submission.',
    fallback: 'The 3D map is unavailable. You can still listen through the voice list.', externalPlace: 'View place on Google Maps',
  },
  ko: {
    connections: '주제 연결',
    memory: '{date}, 한 참여자가 남긴 {topic}에 관한 이야기', memoryNoDate: '한 참여자가 남긴 {topic}에 관한 이야기',
    title: '후쿠오카의 목소리', subtitle: '도시에 겹겹이 쌓인 우리의 기억.', count: '개의 목소리', before: '다른 사람의 목소리 듣기', after: '목소리 지도 둘러보기', more: '다른 목소리 듣기',
    back: '돌아가기', leave: '내 목소리 남기기', close: '닫기', list: '목소리 목록', map: '지도', loading: '목소리를 불러오는 중…', loadingAudio: '음성을 불러오는 중…',
    failed: '목소리를 불러올 수 없습니다.', retry: '다시 불러오기', empty: '아직 목소리가 없습니다.', unavailable: '현재 이 목소리를 재생할 수 없습니다.', unlocated: '선택한 장소 없음', unresolved: '장소를 표시할 수 없음',
    resolving: '장소를 확인하는 중…', group: '이 장소의 목소리', seconds: '초', zoomIn: '확대', zoomOut: '축소', rotate: '회전', reset: '전체 보기',
    food: '음식', travel: '여행', encounter: '만남', other: '기타', unknown: '목소리', saved: '후쿠오카에 당신의 목소리를 남겼습니다.', savedHelp: '목소리 지도에서 다른 사람들의 기억도 만나 보세요.',
    physical: '실물 지도가 있는 행사장에서는 카드를 지도에 놓을 수도 있습니다.', published: '제출 후 누구나 온라인 목소리 지도나 이 태그에서 음성을 듣고 선택한 장소를 볼 수 있습니다.',
    fallback: '3D 지도를 표시할 수 없습니다. 목소리 목록에서 계속 들을 수 있습니다.', externalPlace: 'Google Maps에서 장소 보기',
  },
};

export function describeSoundMapEntry(entry: SoundMapEntry, locale: VisitorLocale) {
  const copy = soundMapMessages[locale];
  const topics = { A: copy.food, B: copy.travel, C: copy.encounter, D: copy.other };
  const date = new Date(entry.createdAt);
  const validDate = !Number.isNaN(date.getTime());
  const formatted = validDate ? new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric', timeZone: 'Asia/Tokyo' }).format(date) : '';
  return (validDate ? copy.memory : copy.memoryNoDate).replace('{date}', formatted).replace('{topic}', entry.categoryCode ? topics[entry.categoryCode] : copy.unknown);
}
