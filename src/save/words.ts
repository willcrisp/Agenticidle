/**
 * The studio-key wordlist: 256 short, unambiguous, typeable words.
 *
 * Exactly 256 so that one word carries exactly 8 bits and the entropy of a key
 * is trivial to reason about: KEY_WORDS words = KEY_WORDS * 8 bits. The list is
 * asserted to be exactly 256 unique entries at module load, because a silent
 * duplicate would quietly bias key generation.
 *
 * Chosen for typing, not flavour: no homophone pairs, nothing over eight
 * letters, nothing that reads as an instruction or a slur, no words that differ
 * only by a plural.
 */
export const WORDS: readonly string[] = [
  "AMBER", "ANCHOR", "ARBOR", "ARGON", "ATLAS", "AURORA", "AXIOM", "AZURE",
  "BACON", "BADGE", "BALLAD", "BAMBOO", "BANJO", "BARGE", "BASALT", "BEACON",
  "BEETLE", "BELLOW", "BENIGN", "BIRCH", "BISHOP", "BISTRO", "BLAZE", "BLOOM",
  "BOLT", "BONSAI", "BORAX", "BOTTLE", "BOULDER", "BRAMBLE", "BRASS", "BRIDGE",
  "BRONZE", "BUCKLE", "BUFFER", "BUGLE", "BUNKER", "BURROW", "CACTUS", "CADENCE",
  "CAMBER", "CAMEL", "CANDLE", "CANOPY", "CANVAS", "CANYON", "CAPSULE", "CARAMEL",
  "CARGO", "CARBON", "CASCADE", "CASHEW", "CASTLE", "CAVERN", "CEDAR", "CELLO",
  "CEMENT", "CINDER", "CIPHER", "CIRCUS", "CITRUS", "CLOVER", "COBALT", "COBBLE",
  "COCOA", "COMET", "COMPASS", "CONDOR", "CORAL", "CORTEX", "COSMOS", "COTTON",
  "COYOTE", "CRATER", "CRAYON", "CRESCENT", "CRIMSON", "CRYSTAL", "CYPRESS", "DAGGER",
  "DAHLIA", "DAMASK", "DAPPLE", "DAWN", "DECOY", "DELTA", "DENIM", "DERBY",
  "DIESEL", "DINGO", "DOLMEN", "DOMINO", "DONUT", "DRAGON", "DRIFTER", "DUNES",
  "EAGLE", "EMBER", "EMBLEM", "EMPIRE", "ENGINE", "ERMINE", "ETHER", "EXODUS",
  "FABLE", "FALCON", "FATHOM", "FEDORA", "FENNEL", "FERRY", "FIDDLE", "FILTER",
  "FLAGON", "FLARE", "FLASK", "FLINT", "FLORIN", "FLOTSAM", "FLUTE", "FORGE",
  "FOSSIL", "FOUNDRY", "FOXTROT", "FRESCO", "FRIGATE", "FULCRUM", "FUNNEL", "FURNACE",
  "GADGET", "GALAXY", "GAMBIT", "GANDER", "GARNET", "GAZEBO", "GEYSER", "GINGER",
  "GIRDER", "GLACIER", "GLIDER", "GRANITE", "GROTTO", "GULLY", "GUSTO", "GYPSUM",
  "HAMMOCK", "HARBOR", "HARVEST", "HAZEL", "HEATHER", "HELIX", "HEMLOCK", "HERALD",
  "HERMIT", "HICKORY", "HOLLOW", "HORNET", "HURDLE", "HYDRA", "ICEBERG", "INDIGO",
  "INGOT", "INKWELL", "IRIS", "IVORY", "JACKAL", "JASPER", "JETTY", "JIGSAW",
  "JOCKEY", "JUNGLE", "JUNIPER", "KELP", "KERNEL", "KESTREL", "KETTLE", "KEYSTONE",
  "KINDLE", "KIOSK", "KITE", "KOALA", "LAGOON", "LANCER", "LANTERN", "LAPIS",
  "LATTICE", "LAVENDER", "LEDGER", "LEGUME", "LEMUR", "LICHEN", "LILAC", "LIMPET",
  "LINDEN", "LINTEL", "LOBSTER", "LOCKET", "LOFT", "LOTUS", "LUMBER", "LYRIC",
  "MAGMA", "MAGNET", "MAGPIE", "MALLET", "MAMMOTH", "MANDREL", "MANGO", "MANTLE",
  "MAPLE", "MARBLE", "MARIGOLD", "MARLIN", "MARMOT", "MARROW", "MASON", "MEADOW",
  "MEDLEY", "MERCURY", "MESA", "METEOR", "MIDNIGHT", "MINARET", "MIRAGE", "MISTRAL",
  "MITTEN", "MONGOOSE", "MONSOON", "MORAINE", "MORTAR", "MOSAIC", "MOSS", "MULLET",
  "MUSLIN", "MUSTANG", "NECTAR", "NEEDLE", "NETTLE", "NIMBUS", "NOMAD", "NOUGAT",
  "NUTMEG", "OASIS", "OBELISK", "OCELOT", "OCTAVE", "OLIVE", "ONYX", "OPAL",
  "ORBIT", "ORCHID", "OREGANO", "OSPREY", "OTTER", "OUTPOST", "OXBOW", "OYSTER",
];

// A duplicate or a miscount would bias generation and silently cost entropy, so
// it is checked once at load rather than trusted.
if (WORDS.length !== 256 || new Set(WORDS).size !== 256) {
  throw new Error(
    `wordlist must be 256 unique words, got ${WORDS.length} (${new Set(WORDS).size} unique)`,
  );
}
