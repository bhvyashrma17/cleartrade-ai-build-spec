/**
 * Everyday names for products Indian manufacturers commonly export, mapped to the HS 2022 codes they
 * may fall under (E-043). They only lift those codes in the finder's search, and where one name covers
 * codes that differ by material or form, the finder asks. They never decide a code: the exporter picks
 * from official descriptions and an agent confirms. A code missing from the loaded list is ignored.
 * Names match the exporter's words with plural "s" ignored ("bedsheets" finds "bedsheet"), and a name
 * inside a longer name of another entry that also matched does not count ("mango pulp" is not "mango").
 */
export interface EverydayName {
  names: string[];
  hs6: string[];
}

export const EVERYDAY_NAMES: readonly EverydayName[] = [
  // Food and agriculture
  { names: ['basmati', 'chawal', 'rice'], hs6: ['100630', '100620', '100640'] },
  { names: ['jeera', 'cumin'], hs6: ['090931', '090932'] },
  { names: ['haldi', 'turmeric'], hs6: ['091030'] },
  { names: ['mirchi', 'red chilli', 'chilli', 'chili'], hs6: ['090421', '090422'] },
  { names: ['elaichi', 'cardamom'], hs6: ['090831', '090832'] },
  { names: ['kali mirch', 'black pepper'], hs6: ['090411', '090412'] },
  { names: ['chai', 'tea'], hs6: ['090230', '090240'] },
  { names: ['kaju', 'cashew'], hs6: ['080131', '080132'] },
  { names: ['jhinga', 'prawn', 'shrimp'], hs6: ['030617', '030616', '030636'] },
  { names: ['ghee'], hs6: ['040590'] },
  { names: ['gur', 'jaggery'], hs6: ['170113'] },
  { names: ['papad', 'papadum', 'papadam'], hs6: ['190590'] },
  { names: ['shahad', 'honey'], hs6: ['040900'] },
  { names: ['pyaz', 'onion'], hs6: ['070310'] },
  { names: ['lehsun', 'garlic'], hs6: ['070320'] },
  { names: ['aloo', 'potato'], hs6: ['070190'] },
  { names: ['aam', 'mango'], hs6: ['080450'] },
  // Cooked fruit purée (2007.99) or fruit otherwise prepared (2008.99); not fresh fruit (E-070).
  { names: ['mango pulp', 'mango puree', 'fruit pulp'], hs6: ['200799', '200899'] },
  { names: ['green coffee', 'raw coffee', 'unroasted coffee'], hs6: ['090111', '090112'] },
  { names: ['instant coffee', 'soluble coffee', 'coffee extract'], hs6: ['210111', '210112'] },
  { names: ['green tea'], hs6: ['090210', '090220'] },
  { names: ['kela', 'banana'], hs6: ['080390'] },
  { names: ['angoor', 'grapes'], hs6: ['080610'] },
  { names: ['cheeni', 'sugar'], hs6: ['170199'] },
  { names: ['til', 'sesame'], hs6: ['120740'] },
  { names: ['moongphali', 'groundnut', 'peanut'], hs6: ['120241', '120242'] },
  { names: ['gehun', 'wheat'], hs6: ['100199'] },
  { names: ['makka', 'maize', 'corn'], hs6: ['100590'] },
  { names: ['castor oil'], hs6: ['151530'] },
  { names: ['guar gum'], hs6: ['130232'] },
  // Household, handicrafts and gifts
  { names: ['agarbatti', 'incense sticks', 'incense', 'dhoop'], hs6: ['330741'] },
  { names: ['pooja thali', 'puja thali', 'thali'], hs6: ['741810', '732393', '691110', '691200'] },
  { names: ['bartan', 'utensils', 'kitchenware'], hs6: ['741810', '732393', '761510', '691110', '691200'] },
  { names: ['murti', 'idol', 'statue', 'statuette'], hs6: ['830629', '442011', '442019', '680291', '691310', '691390'] },
  { names: ['copper bottle'], hs6: ['741810'] },
  // A plain stainless bottle is a household article (7323.93); an insulated one is a vacuum flask (9617).
  { names: ['steel bottle', 'steel water bottle', 'vacuum flask', 'vacuum bottle'], hs6: ['732393', '961700'] },
  { names: ['bangles', 'chudi'], hs6: ['711790', '711719', '711319'] },
  { names: ['imitation jewellery', 'artificial jewellery'], hs6: ['711719', '711790'] },
  { names: ['gold jewellery'], hs6: ['711319'] },
  { names: ['silver jewellery'], hs6: ['711311'] },
  { names: ['diamond', 'diamonds'], hs6: ['710239'] },
  // Textiles and leather
  { names: ['bedsheet', 'bed sheet', 'chadar', 'bed linen'], hs6: ['630231', '630221', '630232'] },
  { names: ['towel'], hs6: ['630260'] },
  { names: ['t-shirt', 'tshirt', 't shirt', 'tee'], hs6: ['610910', '610990'] },
  { names: ['shawl', 'pashmina', 'stole'], hs6: ['621420', '621430', '611710'] },
  { names: ['carpet', 'kaleen', 'rug'], hs6: ['570110', '570190'] },
  { names: ['dari', 'durrie', 'dhurrie'], hs6: ['570210'] },
  { names: ['coir mat', 'coir'], hs6: ['570220'] },
  { names: ['jute bag'], hs6: ['630510', '420222'] },
  { names: ['leather shoes', 'jooti', 'mojari'], hs6: ['640399', '640391'] },
  { names: ['kolhapuri', 'kolhapuri chappal'], hs6: ['640320'] },
  // Building materials
  { names: ['tiles', 'ceramic tiles', 'vitrified tiles'], hs6: ['690721', '690722', '690723'] },
  { names: ['granite'], hs6: ['680293', '251612'] },
  { names: ['marble'], hs6: ['680291', '251512'] },
  // Engineering, pharma and other
  { names: ['dawa', 'medicine', 'medicines', 'tablets'], hs6: ['300490'] },
  { names: ['surgical gloves'], hs6: ['401512'] }, // HS 2022 replaced 4015.11 with 4015.12 (medical, surgical, dental or veterinary)
  { names: ['mobile phone', 'smartphone'], hs6: ['851713'] },
  { names: ['auto parts', 'car parts'], hs6: ['870899'] },
  { names: ['castings', 'iron castings', 'ci castings', 'steel castings'], hs6: ['732510', '732599'] },
  { names: ['pump', 'pumps', 'water pump'], hs6: ['841370'] },
  { names: ['bicycle parts', 'cycle parts'], hs6: ['871499'] },
  { names: ['football', 'footballs'], hs6: ['950662'] },
  { names: ['cricket bat', 'cricket'], hs6: ['950699'] },
];
