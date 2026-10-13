import type { Priority, Role } from './types'

export const PDF_URL = '/documents/revendications-leborgne-en-action.pdf'

export const ROLE_LABELS: Record<Role, string> = {
  '': 'Soutien',
  eleve: 'Lycéen·ne',
  personnel: 'Enseignant·e / personnel',
  parent: 'Parent d’élève',
  ancien: 'Ancien·ne élève',
  soutien: 'Citoyen·ne solidaire',
}

export const PRIORITIES: Priority[] = [
  {
    id: 'repas', number: '01', title: 'Des repas de qualité',
    description: 'Bien manger, en quantité suffisante et à un prix accessible.',
    color: 'blue', icon: 'meals', page: 6,
    observation: 'Les documents transmis signalent une cantine jugée trop chère, une qualité et des quantités insuffisantes, ainsi que des retards de livraison.',
    demands: [
      'Changer de prestataire et améliorer la qualité des repas.',
      'Demander une tarification plus accessible et des portions suffisantes.',
      'Garantir des livraisons à l’heure.',
      'Prévoir des espaces adaptés et autorisés pour déjeuner, avec des règles claires et concertées.',
    ],
  },
  {
    id: 'chaleur', number: '02', title: 'Des salles respirables',
    description: 'Une climatisation fonctionnelle, de l’air et un accès à l’eau.',
    color: 'navy', icon: 'heat', page: 3,
    observation: 'Plusieurs climatiseurs et brasseurs d’air sont signalés en panne, inefficaces ou trop bruyants. Pour environ 900 élèves, les files d’attente limitent l’accès à l’eau.',
    demands: [
      'Réparer les climatiseurs en panne et adapter leur puissance et leur installation aux salles, notamment aux préfabriqués.',
      'Garantir un refroidissement effectif pour tous les élèves.',
      'Réparer ou remplacer les brasseurs d’air défaillants ou trop bruyants.',
      'Installer deux fontaines à eau fraîche supplémentaires, réellement accessibles aux élèves.',
      'Couvrir le plateau sportif de panneaux solaires pour protéger les activités et contribuer à l’alimentation de la climatisation.',
    ],
    note: 'Le dossier rapporte un relevé de 33 °C et 68 % d’humidité en A2, à 14 h. La date, les conditions de mesure et le calcul de l’Humidex restent à préciser. L’Humidex n’est pas une température mesurée.',
  },
  {
    id: 'cafeteria', number: '03', title: 'Une cafétéria propre',
    description: 'Une hygiène rigoureuse et des équipements adaptés au service.',
    color: 'green', icon: 'cafe', page: 6,
    observation: 'Des problèmes d’hygiène lors du service de la cafétéria sont signalés dans les revendications communes.',
    demands: [
      'Demander le port de charlottes et de gants au personnel qui sert les aliments, dans le cadre de pratiques d’hygiène adaptées.',
      'Garantir un service propre et des équipements adaptés.',
      'Clarifier les règles de restauration avec les élèves pour offrir une solution concrète à chacun.',
    ],
  },
  {
    id: 'ordinateurs', number: '04', title: 'Du matériel qui fonctionne',
    description: 'Des ordinateurs réparés, un réseau fiable et un vrai suivi.',
    color: 'blue', icon: 'computer', page: 7,
    observation: 'L’état des lieux transmis indique 7 ordinateurs fonctionnels sur 14 au CDI et 14 sur 32 en salle J5. Des difficultés de réseau, de vidéoprojection et de matériel de travaux pratiques sont également signalées.',
    demands: [
      'Réparer ou remplacer les ordinateurs défaillants et fiabiliser le réseau dans les salles.',
      'Réparer ou renouveler les vidéoprojecteurs et fournir le matériel nécessaire aux TP de SVT et de physique-chimie.',
      'Remplacer les manuels abîmés ou obsolètes, notamment en HGGSP.',
      'Garantir un service informatique dédié à temps plein et pourvoir le poste de secrétaire de direction.',
      'Désigner un référent EBEP et clarifier le pilotage de l’EVARS.',
    ],
  },
  {
    id: 'hygiene', number: '05', title: 'Des espaces sains',
    description: 'Agir face aux nuisibles et entretenir nos lieux de vie.',
    color: 'navy', icon: 'hygiene', page: 6,
    observation: 'La présence de rats, de chauves-souris et d’excréments est signalée dans plusieurs espaces, dont la cantine et le théâtre. Les documents mentionnent aussi le manque de savon et de papier toilette et des ventilateurs poussiéreux.',
    demands: [
      'Mener une opération de dératisation et nettoyer les espaces souillés.',
      'Faire intervenir des professionnels pour les chauves-souris, en respectant leur protection et en sécurisant les lieux.',
      'Installer et approvisionner des distributeurs de savon dans les toilettes et les vestiaires d’EPS, et garantir le papier toilette.',
      'Effectuer un nettoyage complet et régulier des ventilateurs et brasseurs d’air.',
    ],
  },
  {
    id: 'eps', number: '06', title: 'Une EPS dans de bonnes conditions',
    description: 'Des espaces protégés, ventilés et sécurisés pour bouger.',
    color: 'green', icon: 'sport', page: 4,
    observation: 'La chaleur et les intempéries compliquent la pratique physique. L’espace théâtre utilisé en EPS est signalé comme trop chaud et sujet à des infiltrations.',
    demands: [
      'Couvrir le plateau sportif de panneaux solaires pour protéger les activités.',
      'Organiser l’accès au gymnase pour les disciplines adaptées et prévoir des solutions de repli en cas d’intempéries.',
      'Réparer la toiture, traiter les infiltrations et sécuriser les sols et les installations électriques de la salle de musculation.',
      'Mettre en place une ventilation adaptée à l’activité physique.',
      'Garantir le savon et l’entretien des vestiaires.',
    ],
  },
  {
    id: 'autonomie', number: '07', title: 'Plus de confiance, plus d’autonomie',
    description: 'Des sorties simplifiées et des règles construites ensemble.',
    color: 'blue', icon: 'gate', page: 8,
    observation: 'Les élèves signalent des contrôles du carnet et de l’emploi du temps au portail, vécus comme contraignants. Ils demandent une vie scolaire fondée sur la confiance, la concertation et des règles lisibles.',
    demands: [
      'Mettre fin à la vérification systématique du carnet et de l’emploi du temps au portail lors des sorties, avec des règles claires et concertées inscrites au règlement intérieur.',
      'Anticiper les changements d’emploi du temps et mieux répartir les cours.',
      'Allonger la récréation du matin et assurer une ouverture régulière de la permanence.',
      'Demander le rétablissement du créneau d’usage du téléphone de 12 h à 14 h, avec une concertation sur les règles.',
      'Mettre en place un suivi clair des problèmes matériels et un dialogue régulier avec les représentants.',
      'Clarifier par écrit le traitement des absences liées à la mobilisation et réexaminer les situations contestées.',
    ],
  },
]

export const FAQS = [
  {
    question: 'Qui peut signer la pétition ?',
    answer: 'Tout le monde peut soutenir la mobilisation : lycéens, enseignants et personnels, parents, anciens élèves et citoyens solidaires. Il n’est pas nécessaire d’être scolarisé au lycée Yves Leborgne. Votre profil est facultatif.',
  },
  {
    question: 'Mon nom et mon e-mail seront-ils publics ?',
    answer: 'Votre adresse e-mail et votre nom complet ne sont jamais affichés sur le site. Vous pouvez choisir de rendre visibles uniquement votre prénom, l’initiale de votre nom et votre profil dans la liste des soutiens. Cette option est désactivée par défaut. Les éventuels messages restent privés.',
  },
  {
    question: 'Puis-je signer plusieurs fois ?',
    answer: 'Une seule signature est enregistrée par adresse e-mail pour préserver la fiabilité du compteur. Si vous avez déjà signé, vous pouvez continuer à aider en partageant la pétition autour de vous.',
  },
  {
    question: 'Que se passe-t-il après ma signature ?',
    answer: 'Votre signature est enregistrée et ajoutée au compteur. Les signatures sont destinées à appuyer les revendications communes auprès de l’établissement et des autorités compétentes. Conservez la référence privée qui s’affiche après la signature : elle vous permet de la retirer si vous le souhaitez.',
  },
  {
    question: 'Où lire l’ensemble des revendications ?',
    answer: 'Le dossier complet 2026–2027, disponible sur cette page, comporte neuf pages. En plus des sept priorités, il aborde les bâtiments, la sécurité, les moyens humains, la santé et l’avenir scolaire. Les constats sont ceux rapportés dans les documents transmis ; les demandes nouvelles ou précisées restent soumises à validation collective.',
  },
]
