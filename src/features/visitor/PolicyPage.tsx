import { LanguageSwitch } from '../../i18n/LanguageSwitch';
import { useI18n } from '../../i18n/I18nProvider';

export function PolicyLinks() {
  const { locale } = useI18n();
  return <nav className="policy-links" aria-label={locale === 'ja-JP' ? '利用にあたって' : '使用说明'}>
    <a href="#/privacy" target="_blank" rel="noreferrer">{locale === 'ja-JP' ? 'プライバシー' : '隐私说明'}</a>
    <a href="#/terms" target="_blank" rel="noreferrer">{locale === 'ja-JP' ? '利用条件' : '使用条款'}</a>
  </nav>;
}

export function PolicyPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const { locale } = useI18n();
  const ja = locale === 'ja-JP';
  const privacy = kind === 'privacy';
  return <main className="visitor-shell">
    <div className="visitor-topline"><a href="#/">{ja ? '音声アーカイブ' : '声音档案'}</a><span className="topline-rule" /><LanguageSwitch /></div>
    <h1>{privacy ? (ja ? 'プライバシー' : '隐私说明') : (ja ? '利用条件' : '使用条款')}</h1>
    {privacy ? <>
      <p>{ja ? '録音、任意のニックネーム、選んだ思い出の場所は展示タグに紐づけてクラウドに保存され、タグを読み取った方に公開されます。録音は送信するまで公開されません。' : '录音、可选昵称和主动选择的回忆地点会绑定展签并保存在云端，扫描该展签的人可以查看和收听。录音提交前不会公开。'}</p>
      <p>{ja ? '場所の選択はスキップできます。端末の現在地を自動取得しません。自宅など、公開したくない場所や個人情報は含めないでください。マイクは録音開始を押したときだけ使用します。' : '地点可以跳过，不会自动获取手机定位。请勿分享家庭住址或不愿公开的个人信息。只有主动开始录音时才会请求麦克风。'}</p>
      <p>{ja ? '音声の保存には Supabase、地図と検索には Google Maps を利用します。地図の利用時、Google に通信情報や検索内容が送信されます。Google のデータの取扱いには以下のポリシーも適用されます。' : '音频存储使用 Supabase，地图和搜索使用 Google Maps。使用地图时，通信信息和搜索内容会发送给 Google，并适用以下隐私政策。'}</p>
      <p><a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">{ja ? 'Google プライバシー ポリシー' : 'Google 隐私政策'}</a></p>
      <p>{ja ? '削除や保存期間については展示の運営スタッフにお問い合わせください。保存期間と展示終了後の扱いは、運営者による確定が必要です。' : '删除申请和保存期限请联系展览运营人员。具体保存期限和展后处理方式仍需运营方确认。'}</p>
    </> : <>
      <p>{ja ? '福岡市にまつわる思い出を共有する展示です。ご自身が公開できる音声だけを送信してください。他人の個人情報、権利を侵害する内容、公開に同意していない方の声は含めないでください。' : '本展览用于分享与福冈市有关的回忆。请仅提交你有权公开的录音，不包含他人的私人信息、侵权内容或未经同意的声音。'}</p>
      <p>{ja ? 'タグには1つの音声を登録できます。送信前は録り直せますが、送信後の変更や削除は運営スタッフにご相談ください。通信や地図サービスの障害により利用できない場合があります。場所を選ばずに録音することもできます。' : '每枚展签仅绑定一段录音。提交前可以重录；提交后如需修改或删除，请联系运营人员。网络或地图服务故障可能影响使用，你也可以跳过地点直接录音。'}</p>
      <p>{ja ? '地図機能の利用には Google の利用規約が適用されます。' : '地图功能同时适用 Google 的使用条款。'}</p>
      <p><a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noreferrer">{ja ? 'Google Maps 利用規約' : 'Google Maps 使用条款'}</a></p>
    </>}
    <PolicyLinks />
  </main>;
}
