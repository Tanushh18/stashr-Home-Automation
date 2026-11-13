/* The 25 SHINE ONE ESTATE quotes from the We Three app, for the WhatsApp sender. Copied from mobile/src/leads/whatsappAutoTemplates.ts. */
export const STARTER_QUOTES = [
  "🏠 Build Your Dream Home!\nBuild your dream home at just ₹1,000/Sq. Ft. With Material*\n📞 Call: 9310994032\nSHINE ONE ESTATE",
  "🏗️ Your Dream, Our Construction!\nComplete civil construction starting at just ₹1,000/Sq. Ft. With Material*\n📞 9310994032 | SHINE ONE ESTATE",
  "🔑 Turn Your Plot Into Your Dream Home!\nWe build your vision with quality and commitment.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032 – SHINE ONE ESTATE",
  "🧱 Strong Foundations, Better Tomorrow!\nQuality civil construction at just ₹1,000/Sq. Ft. With Material*\n📞 Contact: 9310994032\nSHINE ONE ESTATE",
  "💰 Build Smart, Save More!\nAffordable home construction without compromising on quality.\nStarting ₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🏡 Your Land, Our Expertise!\nHave a plot in Gurgaon? Let's build something beautiful!\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE | 9310994032",
  "🏗️ From Foundation to Finishing!\nComplete civil construction solutions for your dream property.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "✨ Make Your Dream Home a Reality!\nBeautiful construction, trusted materials and professional execution.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🛠️ Tired of Managing Construction Yourself?\nLet our team handle your construction journey.\nStarting at ₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "📐 Have a Plot? Start Building Today!\nTurn your empty plot into a beautiful home.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE | 9310994032",
  "🏠 Your Home, Your Design, Our Responsibility!\nBuild a home that matches your lifestyle and budget.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🧱 Quality Materials. Professional Construction.\nBuild with confidence and give your property a strong foundation.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🔨 Let's Build Something Amazing!\nYour construction project deserves the right team.\nCivil Construction at ₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🌟 One Step Towards Your Dream Home!\nChoose quality, transparency and commitment.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "💎 Affordable Construction, Beautiful Living!\nMake your dream home a reality without stretching your budget.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "👨‍👩‍👧 Build a Home Full of Memories!\nA perfect home for you and your family starts with the right construction team.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🏢 Planning an Independent Floor?\nGet professional civil construction for your residential building.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "📈 Turn Your Plot Into an Investment!\nBuild residential floors and explore rental income opportunities.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🚧 Ready to Start Construction?\nGet in touch for your construction estimate and planning.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🏡 Build Today, Enjoy Tomorrow!\nSmart construction for a better future.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "💧 Built with Care, Designed to Last!\nQuality-focused construction with attention to every detail.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🌆 Gurgaon Is Growing. Build Your Future Here!\nHave land in Gurgaon? Let's turn it into your dream property.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🛠️ From Empty Land to Beautiful Buildings!\nWe bring your construction vision to life.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
  "🤝 Your Trust, Our Commitment!\nTransparent construction services with quality at every step.\n₹1,000/Sq. Ft. With Material*\nSHINE ONE ESTATE",
  "🎯 Don't Just Own a Plot, Build Your Future!\nStart your dream construction journey with Shine One Estate.\n₹1,000/Sq. Ft. With Material*\n📞 9310994032",
];

/** Messages in the box are separated by a line with only three dashes, so a message can have several lines. */
export const SEPARATOR = "\n---\n";
export const textsToBox = (texts) => (texts || []).join(SEPARATOR);
export const boxToTexts = (box) => String(box || "").split(/\n[ \t]*---[ \t]*\n/).map((t) => t.trim()).filter(Boolean);
