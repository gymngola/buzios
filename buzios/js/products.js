/**
 * Búzios Health Club — Default catalog (fallback)
 * Plans and swimming packages treated as products for the admin system.
 */

const DEFAULT_PRODUCTS = [
  // —— Ginásio ——
  {
    id: "plano-bronze",
    name: "Plano Bronze",
    name_en: "Bronze Plan",
    category: "ginasio",
    price: 27000,
    currency: "KZ",
    period: "mensal",
    description: "Musculação e cardio. Plano de treino + 1 avaliação profissional. Sem acompanhamento de personal trainer.",
    description_en: "Weights and cardio. Training plan + 1 professional evaluation. No personal trainer.",
    features: [
      "Musculação e cardio",
      "Plano de treino personalizado",
      "1 avaliação profissional",
      "Sem acompanhamento P.T."
    ],
    features_en: [
      "Weights and cardio",
      "Custom training plan",
      "1 professional evaluation",
      "No PT accompaniment"
    ],
    image: "",
    featured: false,
    active: true,
    order: 1
  },
  {
    id: "plano-prata",
    name: "Plano Prata",
    name_en: "Silver Plan",
    category: "ginasio",
    price: 35000,
    currency: "KZ",
    period: "mensal",
    description: "Cardio, musculação, step/aeróbica, spinning, TRX. Acompanhamento do P.T. + 1 avaliação profissional.",
    description_en: "Cardio, weights, step/aerobics, spinning, TRX. PT accompaniment + 1 professional evaluation.",
    features: [
      "Cardio, musculação, step, spinning, TRX",
      "Acompanhamento do Personal Trainer",
      "1 avaliação profissional",
      "Aulas de grupo (horário Búzios)"
    ],
    features_en: [
      "Cardio, weights, step, spinning, TRX",
      "Personal Trainer accompaniment",
      "1 professional evaluation",
      "Group classes (Búzios schedule)"
    ],
    image: "",
    featured: true,
    active: true,
    order: 2
  },
  {
    id: "plano-platina",
    name: "Plano Platina",
    name_en: "Platinum Plan",
    category: "ginasio",
    price: 54000,
    currency: "KZ",
    period: "mensal",
    description: "Acesso total. Toalha de treino do ginásio. Domingos e feriados (manhãs). Tempo livre total.",
    description_en: "Full access. Gym training towel. Sundays & holidays (mornings). Unlimited time.",
    features: [
      "Acesso total a todas as áreas",
      "Toalha de treino do Gym",
      "Domingos e feriados (manhãs)",
      "Tempo livre total"
    ],
    features_en: [
      "Full access to all areas",
      "Gym training towel",
      "Sundays & holidays (mornings)",
      "Unlimited time"
    ],
    image: "",
    featured: false,
    active: true,
    order: 3
  },
  {
    id: "inscricao-anual",
    name: "Inscrição Anual",
    name_en: "Annual Registration",
    category: "ginasio",
    price: 6500,
    currency: "KZ",
    period: "única",
    description: "Obrigatória na primeira visita. Se se ausentar mais de 90 dias, perde a inscrição e terá de voltar a pagar.",
    description_en: "Mandatory on first visit. Absence over 90 days requires re-registration.",
    features: [
      "Obrigatória na 1ª vez",
      "Válida enquanto mantiver actividade",
      "Perde após 90 dias de ausência"
    ],
    features_en: [
      "Mandatory first time",
      "Valid while active",
      "Lost after 90 days absence"
    ],
    image: "",
    featured: false,
    active: true,
    order: 0
  },
  {
    id: "avaliacao-fisica",
    name: "Avaliação Física (Bioimpedância)",
    name_en: "Physical Evaluation (Bioimpedance)",
    category: "ginasio",
    price: 5000,
    currency: "KZ",
    period: "única",
    description: "Avaliação completa com bioimpedância.",
    description_en: "Full evaluation with bioimpedance.",
    features: [],
    features_en: [],
    image: "",
    featured: false,
    active: true,
    order: 4
  },
  {
    id: "aulas-avulsas",
    name: "Aulas Avulsas (cartão 6 aulas)",
    name_en: "Drop-in Classes (6-class card)",
    category: "ginasio",
    price: 30000,
    currency: "KZ",
    period: "cartão",
    description: "Cartão com 6 aulas avulsas.",
    description_en: "Card with 6 drop-in classes.",
    features: [],
    features_en: [],
    image: "",
    featured: false,
    active: true,
    order: 5
  },

  // —— Natação (packages) ——
  {
    id: "natacao-10",
    name: "Plano 10 Aulas Seguidas",
    name_en: "10 Consecutive Lessons Plan",
    category: "natacao",
    price: 20000,
    currency: "KZ",
    period: "pacote",
    description: "Pacote de 10 aulas de natação seguidas. Piscina aquecida.",
    description_en: "Package of 10 consecutive swimming lessons. Heated pool.",
    features: ["10 aulas", "Piscina aquecida", "Ideal para férias"],
    features_en: ["10 lessons", "Heated pool", "Ideal for holidays"],
    image: "",
    featured: false,
    active: true,
    order: 10
  },
  {
    id: "natacao-15",
    name: "Plano 15 Aulas Seguidas",
    name_en: "15 Consecutive Lessons Plan",
    category: "natacao",
    price: 30000,
    currency: "KZ",
    period: "pacote",
    description: "Pacote de 15 aulas de natação seguidas.",
    description_en: "Package of 15 consecutive swimming lessons.",
    features: ["15 aulas", "Piscina aquecida"],
    features_en: ["15 lessons", "Heated pool"],
    image: "",
    featured: true,
    active: true,
    order: 11
  },
  {
    id: "natacao-25",
    name: "Plano 25 Aulas Seguidas",
    name_en: "25 Consecutive Lessons Plan",
    category: "natacao",
    price: 50000,
    currency: "KZ",
    period: "pacote",
    description: "Pacote de 25 aulas de natação seguidas. Melhor valor.",
    description_en: "Package of 25 consecutive swimming lessons. Best value.",
    features: ["25 aulas", "Piscina aquecida", "Melhor valor"],
    features_en: ["25 lessons", "Heated pool", "Best value"],
    image: "",
    featured: false,
    active: true,
    order: 12
  }
];

const DEFAULT_ZONES = []; // Not used for this service business

const DEFAULT_TEXTS = {
  pt: {
    "hero.eyebrow": "Ginásio & Escola de Natação",
    "hero.title": "Actividade física no presente.\nSaúde no futuro.",
    "hero.sub": "O seu espaço de sempre em Luanda. Musculação, cardio, spinning, TRX e natação em piscina aquecida.",
    "hero.cta1": "Ver planos",
    "hero.cta2": "Inscrever-me",
    "intro.eyebrow": "Sobre nós",
    "intro.title": "Búzios — o seu espaço de sempre",
    "intro.desc": "Localizado no Bairro do Benfica, Kifica, o Búzios Health Club oferece um ambiente completo para a sua saúde: ginásio equipado e escola de natação com piscina aquecida.",
    "intro.f1": "Musculação, cardio, spinning e TRX",
    "intro.f2": "Escola de natação para todas as idades",
    "intro.f3": "Piscina aquecida e hidroginástica",
    "intro.f4": "Acompanhamento de personal trainer",
    "intro.f5": "Horários alargados de manhã e tarde",
    "intro.cta": "Conhecer o ginásio",
    "services.eyebrow": "O que oferecemos",
    "services.title": "Duas áreas. Uma missão.",
    "services.desc": "Ginásio completo e escola de natação com professores formados, em ambiente acolhedor e profissional.",
    "services.gymTitle": "Búzios Health Club",
    "services.gymText": "5 tapetes profissionais, bicicletas elípticas, step, spinning, barras, halteres e máquinas para todos os grupos musculares. Planos Bronze, Prata e Platina.",
    "services.gymCta": "Ver ginásio",
    "services.swimTitle": "Escola de Natação Búzios",
    "services.swimText": "Piscina aquecida. Aulas para bebés, crianças, adolescentes e adultos. Hidroginástica, hidroterapia e planos de férias. Turmas reduzidas (máx. 7 alunos).",
    "services.swimCta": "Ver natação",
    "plans.eyebrow": "Planos de ginásio",
    "plans.title": "Escolha o seu ritmo",
    "plans.desc": "Inscrição anual obrigatória na primeira visita. Todos os planos incluem acesso ao equipamento e avaliação profissional.",
    "plans.cta": "Todos os planos e preços",
    "cta.title": "Pronto para começar?",
    "cta.desc": "Preencha o formulário de inscrição ou de contacto. A nossa equipa responde com todas as informações.",
    "cta.btn": "Fazer inscrição",
    "loc.eyebrow": "Onde estamos",
    "loc.title": "Benfica · Kifica · Luanda",
    "loc.addressTitle": "Morada",
    "loc.hoursTitle": "Horário",
    "loc.contactTitle": "Contacto",
    "footer.newsletter": "Receba novidades e promoções",
    "footer.subscribe": "Subscrever",
    "footer.note": "Ao subscrever, aceita receber novidades e actualizações directamente no seu telemóvel."
  },
  en: {
    "hero.eyebrow": "Gym & Swimming School",
    "hero.title": "Physical activity today.\nHealth for tomorrow.",
    "hero.sub": "Your space in Luanda. Weights, cardio, spinning, TRX and swimming in a heated pool.",
    "hero.cta1": "View plans",
    "hero.cta2": "Enroll",
    "intro.eyebrow": "About us",
    "intro.title": "Búzios — your space, always",
    "intro.desc": "Located in Benfica, Kifica, Búzios Health Club offers a complete environment for your health: fully equipped gym and swimming school with heated pool.",
    "intro.f1": "Weights, cardio, spinning and TRX",
    "intro.f2": "Swimming school for all ages",
    "intro.f3": "Heated pool and hydrogymnastics",
    "intro.f4": "Personal trainer accompaniment",
    "intro.f5": "Extended morning and afternoon hours",
    "intro.cta": "Discover the gym",
    "services.eyebrow": "What we offer",
    "services.title": "Two areas. One mission.",
    "services.desc": "Full gym and swimming school with trained instructors, in a welcoming and professional environment.",
    "services.gymTitle": "Búzios Health Club",
    "services.gymText": "5 professional treadmills, ellipticals, step, spinning, bars, dumbbells and machines for all muscle groups. Bronze, Silver and Platinum plans.",
    "services.gymCta": "View gym",
    "services.swimTitle": "Búzios Swimming School",
    "services.swimText": "Heated pool. Lessons for babies, children, teens and adults. Hydrogymnastics, hydrotherapy and holiday packages. Small groups (max 7).",
    "services.swimCta": "View swimming",
    "plans.eyebrow": "Gym plans",
    "plans.title": "Choose your pace",
    "plans.desc": "Annual registration required on first visit. All plans include equipment access and professional evaluation.",
    "plans.cta": "All plans and prices",
    "cta.title": "Ready to start?",
    "cta.desc": "Fill in the enrollment or contact form. Our team will reply with all the information.",
    "cta.btn": "Enroll now",
    "loc.eyebrow": "Find us",
    "loc.title": "Benfica · Kifica · Luanda",
    "loc.addressTitle": "Address",
    "loc.hoursTitle": "Hours",
    "loc.contactTitle": "Contact",
    "footer.newsletter": "Get news and offers",
    "footer.subscribe": "Subscribe",
    "footer.note": "By subscribing you agree to receive news and updates on your phone."
  }
};

const DEFAULT_SITE_IMAGES = {
  hero: "https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=1600&q=80",
  hero2: "",
  intro: "https://images.unsplash.com/photo-1571902943202-507ec2618e8f?w=900&q=80",
  ginasio: "https://images.unsplash.com/photo-1517836357463-d25dfeac3438?w=1200&q=80",
  natacao: "https://images.unsplash.com/photo-1530549387789-4c1017266635?w=1200&q=80",
  promo: ""
};

// Expose for app.js / admin.js
window.DEFAULT_PRODUCTS = DEFAULT_PRODUCTS;
window.DEFAULT_ZONES = DEFAULT_ZONES;
window.DEFAULT_TEXTS = DEFAULT_TEXTS;
window.DEFAULT_SITE_IMAGES = DEFAULT_SITE_IMAGES;
