// Phrases worth knowing in the places you're going, when the language isn't yours (the app is in English).
// A short, practical set per language, each with how it sounds; languages in another script also show it in Latin letters.
// Each language links to its Wikivoyage phrasebook for more.

/** `sound`: the phrase in Latin letters (pinyin, rōmaji…) for other scripts; `like`: how it sounds, for English speakers. */
export type Phrase = { en: string; say: string; sound?: string; like?: string; note?: string };

/** The phrases, in this order, for every language. */
export const PHRASE_KEYS = [
  "Hello", "Please", "Thank you", "Yes / No", "Excuse me", "Sorry", "Do you speak English?", "I don't understand",
  "How much is it?", "Where is the toilet?", "The bill, please", "A table for two, please", "I'm allergic to …",
  "Help!", "Please call an ambulance", "Goodbye",
] as const;

type Row = [say: string, sound?: string, note?: string];

const P: Record<string, Row[]> = {
  es: [["Hola"], ["Por favor"], ["Gracias"], ["Sí / No"], ["Disculpe"], ["Lo siento"], ["¿Habla inglés?"], ["No entiendo"],
    ["¿Cuánto cuesta?"], ["¿Dónde está el baño?"], ["La cuenta, por favor"], ["Una mesa para dos, por favor"],
    ["Soy alérgico a …", undefined, "alérgica if you're a woman"], ["¡Ayuda!"], ["Llame a una ambulancia, por favor"], ["Adiós"]],
  pt: [["Olá"], ["Por favor"], ["Obrigado", undefined, "Obrigada if you're a woman"], ["Sim / Não"], ["Com licença"], ["Desculpe"],
    ["Você fala inglês?"], ["Não entendo"], ["Quanto custa?"], ["Onde fica o banheiro?", undefined, "In Portugal: a casa de banho"],
    ["A conta, por favor"], ["Uma mesa para dois, por favor"], ["Sou alérgico a …", undefined, "alérgica if you're a woman"],
    ["Socorro!"], ["Chame uma ambulância, por favor"], ["Tchau"]],
  fr: [["Bonjour"], ["S'il vous plaît"], ["Merci"], ["Oui / Non"], ["Excusez-moi"], ["Pardon"], ["Vous parlez anglais ?"],
    ["Je ne comprends pas"], ["C'est combien ?"], ["Où sont les toilettes ?"], ["L'addition, s'il vous plaît"],
    ["Une table pour deux, s'il vous plaît"], ["Je suis allergique à …"], ["Au secours !"], ["Appelez une ambulance, s'il vous plaît"], ["Au revoir"]],
  it: [["Buongiorno", undefined, "Ciao with friends"], ["Per favore"], ["Grazie"], ["Sì / No"], ["Mi scusi"], ["Mi dispiace"],
    ["Parla inglese?"], ["Non capisco"], ["Quanto costa?"], ["Dov'è il bagno?"], ["Il conto, per favore"],
    ["Un tavolo per due, per favore"], ["Sono allergico a …", undefined, "allergica if you're a woman"], ["Aiuto!"],
    ["Chiami un'ambulanza, per favore"], ["Arrivederci"]],
  de: [["Guten Tag", undefined, "Hallo is fine too"], ["Bitte"], ["Danke"], ["Ja / Nein"], ["Entschuldigung"], ["Es tut mir leid"],
    ["Sprechen Sie Englisch?"], ["Ich verstehe nicht"], ["Was kostet das?"], ["Wo ist die Toilette?"], ["Die Rechnung, bitte"],
    ["Einen Tisch für zwei, bitte"], ["Ich bin allergisch gegen …"], ["Hilfe!"], ["Rufen Sie bitte einen Krankenwagen"], ["Auf Wiedersehen"]],
  nl: [["Hallo"], ["Alstublieft"], ["Dank u wel"], ["Ja / Nee"], ["Pardon"], ["Sorry"], ["Spreekt u Engels?"], ["Ik begrijp het niet"],
    ["Hoeveel kost het?"], ["Waar is het toilet?"], ["Mag ik de rekening?"], ["Een tafel voor twee, alstublieft"],
    ["Ik ben allergisch voor …"], ["Help!"], ["Bel een ambulance, alstublieft"], ["Tot ziens"]],
  ja: [["こんにちは", "konnichiwa"], ["お願いします", "onegaishimasu"], ["ありがとうございます", "arigatō gozaimasu"], ["はい / いいえ", "hai / iie"],
    ["すみません", "sumimasen", "Also a light “sorry”"], ["ごめんなさい", "gomen nasai"], ["英語を話せますか？", "eigo o hanasemasu ka?"],
    ["わかりません", "wakarimasen"], ["いくらですか？", "ikura desu ka?"], ["トイレはどこですか？", "toire wa doko desu ka?"],
    ["お会計お願いします", "okaikei onegaishimasu"], ["二人です", "futari desu", "“Two people”, said as you walk in"],
    ["…のアレルギーがあります", "… no arerugī ga arimasu"], ["助けて！", "tasukete!"], ["救急車を呼んでください", "kyūkyūsha o yonde kudasai"],
    ["さようなら", "sayōnara"]],
  zh: [["你好", "nǐ hǎo"], ["请", "qǐng"], ["谢谢", "xièxie"], ["是 / 不是", "shì / bú shì"], ["打扰一下", "dǎrǎo yíxià"], ["对不起", "duìbuqǐ"],
    ["你会说英语吗？", "nǐ huì shuō yīngyǔ ma?"], ["我听不懂", "wǒ tīng bu dǒng"], ["多少钱？", "duōshao qián?"],
    ["洗手间在哪里？", "xǐshǒujiān zài nǎlǐ?"], ["买单", "mǎidān"], ["两位", "liǎng wèi", "“Two people”"],
    ["我对…过敏", "wǒ duì … guòmǐn"], ["救命！", "jiùmìng!"], ["请叫救护车", "qǐng jiào jiùhùchē"], ["再见", "zàijiàn"]],
  ko: [["안녕하세요", "annyeonghaseyo"], ["주세요", "juseyo", "Said after what you'd like"], ["감사합니다", "gamsahamnida"], ["네 / 아니요", "ne / aniyo"],
    ["저기요", "jeogiyo", "To get someone's attention"], ["죄송합니다", "joesonghamnida"], ["영어 하세요?", "yeongeo haseyo?"],
    ["이해가 안 돼요", "ihaega an dwaeyo"], ["얼마예요?", "eolmayeyo?"], ["화장실이 어디예요?", "hwajangsiri eodiyeyo?"],
    ["계산서 주세요", "gyesanseo juseyo"], ["두 명이요", "du myeongiyo", "“Two people”"], ["…에 알레르기가 있어요", "…e allereugiga isseoyo"],
    ["도와주세요!", "dowajuseyo!"], ["구급차 불러 주세요", "gugeupcha bulleo juseyo"], ["안녕히 계세요", "annyeonghi gyeseyo"]],
  th: [["สวัสดีครับ / ค่ะ", "sawatdee khrap / kha", "End with khrap if you're a man, kha if you're a woman"], ["ขอ…ครับ / ค่ะ", "khŏr … khrap / kha", "“May I have …”"],
    ["ขอบคุณครับ / ค่ะ", "khop khun khrap / kha"], ["ใช่ / ไม่ใช่", "chai / mai chai"], ["ขอโทษครับ / ค่ะ", "khŏr thôht khrap / kha", "Also “sorry”"],
    ["ขอโทษครับ / ค่ะ", "khŏr thôht khrap / kha"], ["พูดภาษาอังกฤษได้ไหม", "phûut phaa-săa ang-grìt dâai mái?"], ["ไม่เข้าใจ", "mâi khâo jai"],
    ["เท่าไหร่", "tâo rài?"], ["ห้องน้ำอยู่ที่ไหน", "hông náam yùu thîi năi?"], ["เช็คบิลครับ / ค่ะ", "chék bin khrap / kha"],
    ["สองที่ครับ / ค่ะ", "sŏng thîi khrap / kha"], ["แพ้…", "pháe …", "“Allergic to …”"], ["ช่วยด้วย", "chûay dûay!"],
    ["เรียกรถพยาบาลให้หน่อย", "rîak rót phá-yaa-baan hâi nòy"], ["ลาก่อน", "laa gòn"]],
  vi: [["Xin chào"], ["Làm ơn"], ["Cảm ơn"], ["Vâng / Không", undefined, "In the south: Dạ for yes"], ["Xin lỗi", undefined, "Also “sorry”"], ["Xin lỗi"],
    ["Bạn có nói tiếng Anh không?"], ["Tôi không hiểu"], ["Bao nhiêu tiền?"], ["Nhà vệ sinh ở đâu?"], ["Tính tiền"], ["Bàn cho hai người"],
    ["Tôi bị dị ứng với …"], ["Cứu tôi với!"], ["Gọi xe cứu thương giúp tôi"], ["Tạm biệt"]],
  id: [["Halo"], ["Tolong", undefined, "When asking; silakan when offering"], ["Terima kasih"], ["Ya / Tidak"], ["Permisi"], ["Maaf"],
    ["Bisa bahasa Inggris?"], ["Saya tidak mengerti"], ["Berapa harganya?"], ["Toiletnya di mana?"], ["Minta bonnya"],
    ["Meja untuk dua orang"], ["Saya alergi …"], ["Tolong!"], ["Tolong panggil ambulans"], ["Sampai jumpa"]],
  tr: [["Merhaba"], ["Lütfen"], ["Teşekkür ederim"], ["Evet / Hayır"], ["Affedersiniz"], ["Özür dilerim"], ["İngilizce biliyor musunuz?"],
    ["Anlamıyorum"], ["Ne kadar?"], ["Tuvalet nerede?"], ["Hesap, lütfen"], ["İki kişilik bir masa, lütfen"], ["… alerjim var"],
    ["İmdat!"], ["Lütfen ambulans çağırın"], ["Hoşça kalın"]],
  el: [["Γεια σας", "yia sas"], ["Παρακαλώ", "parakaló"], ["Ευχαριστώ", "efcharistó"], ["Ναι / Όχι", "ne / óchi", "Careful: ne means yes"],
    ["Συγγνώμη", "signómi", "Also “sorry”"], ["Συγγνώμη", "signómi"], ["Μιλάτε αγγλικά;", "miláte angliká?"], ["Δεν καταλαβαίνω", "den katalavéno"],
    ["Πόσο κάνει;", "póso káni?"], ["Πού είναι η τουαλέτα;", "poú íne i toualéta?"], ["Τον λογαριασμό, παρακαλώ", "ton logariasmó, parakaló"],
    ["Ένα τραπέζι για δύο", "éna trapézi ya dío"], ["Είμαι αλλεργικός σε …", "íme alergikós se …", "alergikí if you're a woman"],
    ["Βοήθεια!", "voíthia!"], ["Καλέστε ασθενοφόρο", "kaléste asthenofóro"], ["Αντίο", "adío"]],
  ar: [["مرحبا", "marhaban"], ["من فضلك", "min fadlak", "min fadlik to a woman"], ["شكرا", "shukran"], ["نعم / لا", "na'am / la"],
    ["لو سمحت", "law samaht"], ["آسف", "aasif", "aasfa if you're a woman"], ["هل تتكلم الإنجليزية؟", "hal tatakallam al-ingliziyya?"],
    ["لا أفهم", "la afham"], ["بكم هذا؟", "bikam hadha?"], ["أين الحمام؟", "ayna al-hammam?"], ["الحساب من فضلك", "al-hisab min fadlak"],
    ["طاولة لشخصين", "tawila li-shakhsayn"], ["عندي حساسية من …", "'indi hasasiyya min …"], ["النجدة!", "an-najda!"],
    ["اتصل بالإسعاف", "ittasil bil-is'af"], ["مع السلامة", "ma'a as-salama"]],
};

/**
 * How each phrase sounds, spelled the way an English speaker would read it, like a dictionary's pronunciation guide:
 * syllables split by hyphens, the stressed one in capitals. "kh" is a throaty h (Scottish "loch"), "zh" the s in
 * "measure", "dh" the th in "this". Japanese and Korean give every syllable the same weight, so they have no capitals.
 */
const LIKE: Record<string, string[]> = {
  es: ["OH-lah", "por fah-VOR", "GRAH-see-ahs", "see / noh", "dees-KOOL-peh", "loh SYEN-toh", "AH-blah een-GLES", "noh en-TYEN-doh",
    "KWAN-toh KWES-tah", "DON-deh es-TAH el BAH-nyoh", "lah KWEN-tah, por fah-VOR", "OO-nah MEH-sah PAH-rah dohs, por fah-VOR",
    "soy ah-LER-hee-koh ah …", "ah-YOO-dah", "YAH-meh ah OO-nah ahm-boo-LAHN-syah, por fah-VOR", "ah-DYOS"],
  pt: ["oh-LAH", "poor fah-VOR", "oh-bree-GAH-doo", "seeng / nowng", "kohng lee-SEN-sah", "jees-KOOL-pee", "voh-SEH FAH-lah eeng-GLEHS",
    "nowng en-TEN-doo", "KWAN-too KOOS-tah", "OHN-jee FEE-kah oo bah-NYAY-roo", "ah KOHN-tah, poor fah-VOR",
    "OO-mah MEH-zah PAH-rah doys, poor fah-VOR", "soh ah-LEHR-zhee-koo ah …", "soh-KOH-hoo", "SHAH-mee OO-mah ahm-boo-LAHN-syah, poor fah-VOR", "chow"],
  fr: ["bohn-ZHOOR", "seel voo PLEH", "mehr-SEE", "wee / nohn", "ex-kew-zay MWAH", "par-DOHN", "voo par-lay ahn-GLEH", "zhuh nuh kohm-PRAHN pah",
    "seh kohm-BYAN", "oo sohn lay twah-LET", "lah-dee-SYOHN, seel voo PLEH", "ewn TAH-bluh poor DUH, seel voo PLEH",
    "zhuh swee ah-lehr-ZHEEK ah …", "oh suh-KOOR", "ah-puh-LAY ewn ahm-bew-LAHNS, seel voo PLEH", "oh ruh-VWAHR"],
  it: ["bwon-JOR-noh", "pehr fah-VOH-reh", "GRAHT-tsyeh", "see / noh", "mee SKOO-zee", "mee dee-SPYAH-cheh", "PAR-lah een-GLEH-zeh",
    "nohn kah-PEES-koh", "KWAN-toh KOS-tah", "doh-VEH eel BAH-nyoh", "eel KOHN-toh, pehr fah-VOH-reh",
    "oon TAH-voh-loh pehr DOO-eh, pehr fah-VOH-reh", "SOH-noh ahl-LEHR-jee-koh ah …", "ah-YOO-toh",
    "KYAH-mee oo-nahm-boo-LAHN-tsah, pehr fah-VOH-reh", "ah-ree-veh-DEHR-chee"],
  de: ["GOO-ten TAHK", "BIT-tuh", "DAHN-kuh", "yah / nine", "ent-SHOOL-dee-goong", "es toot meer LITE", "SHPREH-khen zee ENG-lish",
    "ikh fer-SHTAY-uh nikht", "vahs KOS-tet dahs", "voh ist dee toy-LET-tuh", "dee REKH-noong, BIT-tuh", "EYE-nen tish fewr TSVY, BIT-tuh",
    "ikh bin ah-LEHR-gish GAY-gen …", "HIL-fuh", "ROO-fen zee BIT-tuh EYE-nen KRAHN-ken-vah-gen", "owf VEE-der-zay-en"],
  nl: ["HAH-loh", "ahl-stew-BLEEFT", "dahnk ew VEL", "yah / nay", "par-DON", "SOR-ree", "spraykt ew ENG-uls", "ik buh-KHRAYP uht neet",
    "hoo-VAYL kost uht", "vahr is uht twah-LET", "makh ik duh RAY-kuh-ning", "uhn TAH-ful vohr tvay, ahl-stew-BLEEFT",
    "ik ben ah-LEHR-khees vohr …", "help", "bel uhn ahm-bew-LAHN-suh, ahl-stew-BLEEFT", "tot ZEENS"],
  ja: ["kon-nee-chee-wah", "oh-neh-gai-shee-mahs", "ah-ree-gah-toh goh-zai-mahs", "hai / ee-eh", "soo-mee-mah-sen", "goh-men nah-sai",
    "eh-ee-goh oh hah-nah-seh-mahs kah", "wah-kah-ree-mah-sen", "ee-koo-rah dess kah", "toh-ee-reh wah doh-koh dess kah",
    "oh-kai-keh oh-neh-gai-shee-mahs", "foo-tah-ree dess", "… noh ah-reh-roo-gee gah ah-ree-mahs", "tahs-keh-teh",
    "kyoo-kyoo-shah oh yohn-deh koo-dah-sai", "sah-yoh-nah-rah"],
  zh: ["nee HOW", "CHING", "SHYEH-shyeh", "SHR / boo SHR", "dah-RAOW ee-SHYAH", "DWAY-boo-chee", "nee HWAY shwoh EENG-yoo mah",
    "waw TEENG boo DAWNG", "DWAW-shaow CHYEN", "shee-SHOW-jyen dzai NAH-lee", "my-DAHN", "LYAHNG way", "waw DWAY … gwaw-MEEN",
    "JYOH-meeng", "ching JYAOW jyoh-HOO-chuh", "dzai-JYEN"],
  ko: ["ahn-nyong-hah-seh-yo", "joo-seh-yo", "gahm-sah-hahm-nee-dah", "neh / ah-nee-yo", "juh-gee-yo", "jweh-song-hahm-nee-dah",
    "yong-uh hah-seh-yo", "ee-heh-gah ahn dweh-yo", "ul-mah-yeh-yo", "hwah-jahng-shee-ree uh-dee-yeh-yo", "geh-sahn-suh joo-seh-yo",
    "doo myong-ee-yo", "…-eh ahl-leh-reu-gee-gah ee-ssuh-yo", "doh-wah-joo-seh-yo", "goo-geup-chah bool-luh joo-seh-yo",
    "ahn-nyong-hee geh-seh-yo"],
  th: ["sah-wah-DEE krahp / kah", "kor … krahp / kah", "kop KOON krahp / kah", "chai / my chai", "kor TOHT krahp / kah", "kor TOHT krahp / kah",
    "poot pah-SAH ahng-GRIT dai MY", "my kow JAI", "tow RAI", "hong NAHM yoo TEE nai", "check BIN krahp / kah", "song TEE krahp / kah",
    "PAIR …", "CHOO-ay DOO-ay", "ree-uhk rot pah-yah-BAHN hai NOY", "lah GORN"],
  vi: ["sin CHOW", "lahm UHN", "gahm UHN", "vuhng / KHOHNG", "sin LOY", "sin LOY", "bahn gaw noy tyeng AHN khohng", "toy khohng HYEW",
    "bow nyew TYEN", "nyah vay sing uh DOH", "ting TYEN", "bahn chaw hai NGOO-uh-ee", "toy bee zee ung VUH-ee …", "KOO-oo toy VUH-ee",
    "goy seh koo-oo too-uhng ZOOP toy", "tahm BYET"],
  id: ["HAH-loh", "TOH-long", "tuh-REE-mah KAH-see", "yah / TEE-dahk", "per-MEE-see", "MAH-ahf", "BEE-sah bah-HAH-sah ING-grees",
    "SAH-yah TEE-dahk muh-NGER-tee", "buh-RAH-pah har-GAH-nyah", "toy-LET-nyah dee MAH-nah", "MIN-tah BON-nyah",
    "MEH-jah OON-took DOO-ah OH-rahng", "SAH-yah ah-LER-gee …", "TOH-long", "TOH-long PAHNG-gil AHM-boo-lahns", "SAHM-pai JOOM-pah"],
  tr: ["MEHR-hah-bah", "LEWT-fen", "teh-shek-KEWR eh-deh-REEM", "eh-VET / HAH-yuhr", "ahf-feh-DEHR-see-neez", "ur-ZEWR dee-leh-REEM",
    "een-gee-LEEZ-jeh bee-LEE-yor moo-soo-NOOZ", "ahn-LAH-muh-yo-room", "neh kah-DAHR", "too-vah-LET NEH-reh-deh", "heh-SAHP, LEWT-fen",
    "ee-KEE kee-shee-LEEK beer MAH-sah, LEWT-fen", "… ah-lehr-ZHEEM vahr", "eem-DAHT", "LEWT-fen ahm-boo-LAHNS chah-UH-ruhn", "HOSH-chah kah-LUHN"],
  el: ["YAH sahs", "pah-rah-kah-LOH", "ef-khah-ree-STOH", "neh / OH-khee", "seegh-NOH-mee", "seegh-NOH-mee", "mee-LAH-teh ahn-glee-KAH",
    "dhen kah-tah-lah-VEH-noh", "POH-soh KAH-nee", "poo EE-neh ee too-ah-LEH-tah", "tohn loh-ghah-ryahz-MOH, pah-rah-kah-LOH",
    "EH-nah trah-PEH-zee yah DHEE-oh", "EE-meh ah-ler-yee-KOS seh …", "voh-EE-thee-ah", "kah-LEH-steh ahs-theh-noh-FOH-roh", "ah-DYOH"],
  ar: ["MAR-hah-bahn", "min FAD-lak", "SHOO-krahn", "NAH-ahm / lah", "law SAH-maht", "AH-sif", "hal ta-ta-KAL-lam al-in-glee-ZEE-yah",
    "lah AF-ham", "BEE-kam HAA-dhah", "AY-nah al-ham-MAHM", "al-hee-SAHB min FAD-lak", "TAH-wee-lah lee-shakh-SAYN",
    "IN-dee ha-saa-SEE-yah min …", "an-NAJ-dah", "IT-ta-sil bil-is-AHF", "MAH-ah as-sah-LAH-mah"],
};

/** A word on how the language sounds, for the ones where the spelling above can't carry it all. */
const HOW: Record<string, string> = {
  zh: "Mandarin is tonal: the same sound in another pitch is another word. The marks on the pinyin (ā á ǎ à) show each tone; the capitals show the syllable to lean on.",
  th: "Thai is tonal: the same sound in another pitch is another word. Men end polite phrases with krahp, women with kah.",
  vi: "Vietnamese is tonal: the marks on the letters show each word's pitch, so the spelling here is only a start.",
  ja: "Every syllable gets about the same length and weight; a final u is barely said (dess, not deh-soo).",
  ko: "Every syllable gets about the same weight; say it evenly, without leaning on any part.",
  ar: "Said here as in most of the Gulf and Levant; the letters ' and ʿ are a small catch in the throat.",
  fr: "Final letters are mostly silent, and n after a vowel is said through the nose (bohn, not bonn).",
  pt: "As said in Brazil. In Portugal it's softer and faster, with more sh sounds.",
  es: "Every vowel is short and clear, as in ah, eh, ee, oh, oo. In Spain, c and z before e or i are said like th.",
};

/** The main language of a country, where it isn't English. Countries not here: no phrases suggested. */
const COUNTRY_LANGUAGE: Record<string, string> = {
  // Spanish
  ES: "es", MX: "es", CO: "es", AR: "es", CL: "es", PE: "es", EC: "es", BO: "es", PY: "es", UY: "es", VE: "es", CR: "es", PA: "es",
  GT: "es", HN: "es", SV: "es", NI: "es", DO: "es", CU: "es", PR: "es",
  PT: "pt", BR: "pt", AO: "pt", MZ: "pt", CV: "pt",
  FR: "fr", BE: "fr", LU: "fr", MC: "fr", SN: "fr", CI: "fr", PF: "fr",
  IT: "it", SM: "it", VA: "it", DE: "de", AT: "de", CH: "de", LI: "de", NL: "nl",
  JP: "ja", CN: "zh", TW: "zh", KR: "ko", TH: "th", VN: "vi", ID: "id", TR: "tr", GR: "el", CY: "el",
  AE: "ar", SA: "ar", QA: "ar", JO: "ar", EG: "ar", MA: "ar", TN: "ar", OM: "ar", BH: "ar", KW: "ar", LB: "ar",
  // No phrase list yet: linked to their phrasebooks.
  PL: "pl", CZ: "cs", SK: "sk", HU: "hu", RO: "ro", BG: "bg", HR: "hr", SI: "sl", RS: "sr", RU: "ru", UA: "uk", SE: "sv", NO: "no",
  DK: "da", FI: "fi", IS: "is", EE: "et", LV: "lv", LT: "lt", IL: "he", IR: "fa", MY: "ms", KH: "km", LA: "lo", MM: "my", NP: "ne",
  LK: "si", BD: "bn", HK: "yue", MN: "mn", GE: "ka", AM: "hy", AL: "sq", BA: "bs", ME: "sr", MK: "mk",
};

const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
export const languageName = (code: string) => (code === "yue" ? "Cantonese" : code === "zh" ? "Mandarin Chinese" : languageNames.of(code) ?? code);

export type Phrasebook = { lang: string; name: string; countries: string[]; phrases: Phrase[]; more: string; script?: string; how?: string };

/** The languages to learn a few words of, for the countries on a trip (in trip order), skipping your own (English). */
export function phrasebooks(countryCodes: string[], yours = "en"): Phrasebook[] {
  const out = new Map<string, Phrasebook>();
  for (const cc of countryCodes) {
    const lang = COUNTRY_LANGUAGE[cc];
    if (!lang || lang === yours) continue;
    const book = out.get(lang);
    if (book) {
      if (!book.countries.includes(cc)) book.countries.push(cc);
      continue;
    }
    const name = languageName(lang);
    out.set(lang, {
      lang,
      name,
      countries: [cc],
      phrases: (P[lang] ?? []).map(([say, sound, note], i) => ({ en: PHRASE_KEYS[i], say, sound, like: LIKE[lang]?.[i], note })),
      how: HOW[lang],
      more: `https://en.wikivoyage.org/wiki/${encodeURIComponent(`${lang === "zh" ? "Chinese" : name.replace(/ Bokmål$/, "")} phrasebook`.replace(/ /g, "_"))}`,
      script: lang === "zh" && cc === "TW" ? "Written in simplified characters; Taiwan uses traditional ones, but spoken it's the same." : undefined,
    });
  }
  return [...out.values()];
}
