/**
 * 100 English Visual Idioms — Multi-Agent Benchmark Dataset
 *
 * Each entry has:
 *   phrase       – the canonical idiom string (used for correctness checking)
 *   hint         – a meaning clue shown to human observers (NOT given to agents)
 *   difficulty   – easy / medium / hard (visual decodability)
 *   visualPrompt – fal.ai SDXL prompt that LITERALLY depicts the phrase words
 *                  so that vision models can reverse-engineer the idiom
 */

export type IdiomDifficulty = 'easy' | 'medium' | 'hard';

export interface BenchmarkIdiom {
  id:           number;
  phrase:       string;
  hint:         string;
  difficulty:   IdiomDifficulty;
  visualPrompt: string;
}

export const BENCHMARK_IDIOMS: BenchmarkIdiom[] = [
  // ── Easy ──────────────────────────────────────────────────────────────────
  { id:  1, phrase: "Piece of cake",               hint: "Something very easy to do",                           difficulty: "easy",   visualPrompt: "A perfectly sliced piece of layered chocolate cake on a silver plate, studio white background, food photography" },
  { id:  2, phrase: "Break a leg",                 hint: "Good luck — used for performances",                   difficulty: "easy",   visualPrompt: "A theatrical stage spotlight on a single ceramic leg figurine snapped in half, dramatic shadow, stage floor" },
  { id:  3, phrase: "Spill the beans",             hint: "Reveal a secret accidentally",                        difficulty: "easy",   visualPrompt: "Colorful beans dramatically spilling out of an overturned glass jar onto a white surface, high-speed photography" },
  { id:  4, phrase: "Cold feet",                   hint: "To be nervous about a decision",                      difficulty: "easy",   visualPrompt: "Close-up of human bare feet surrounded by frost and small ice crystals, cold blue light, macro lens" },
  { id:  5, phrase: "Hit the nail on the head",    hint: "To be exactly right about something",                 difficulty: "easy",   visualPrompt: "A metal hammer striking a nail dead-center on a wooden plank, dramatic action shot, sawdust flying" },
  { id:  6, phrase: "Elephant in the room",        hint: "An obvious problem no one discusses",                 difficulty: "easy",   visualPrompt: "A large gray elephant standing casually in a cozy living room with furniture, realistic, wide shot" },
  { id:  7, phrase: "Raining cats and dogs",       hint: "Raining very heavily",                                difficulty: "easy",   visualPrompt: "Cartoon cats and dogs falling from storm clouds in a rainy sky, colorful and whimsical illustration" },
  { id:  8, phrase: "Let the cat out of the bag",  hint: "Accidentally reveal a secret",                        difficulty: "easy",   visualPrompt: "A surprised cat bursting out of an open burlap bag, dynamic motion blur, white background" },
  { id:  9, phrase: "Bite the bullet",             hint: "Endure a painful or difficult situation",             difficulty: "easy",   visualPrompt: "Close-up of human teeth biting down on a shiny brass bullet, dramatic macro photography" },
  { id: 10, phrase: "Under the weather",           hint: "Feeling ill or unwell",                               difficulty: "easy",   visualPrompt: "A small human figure huddled under a dark storm cloud with rain falling only on them, isolated, symbolic illustration" },
  { id: 11, phrase: "Burn bridges",                hint: "Permanently damage a relationship",                   difficulty: "easy",   visualPrompt: "A wooden bridge over a river engulfed in orange flames, dramatic night photography, reflections in water" },
  { id: 12, phrase: "Jump the gun",                hint: "To start something too early",                        difficulty: "easy",   visualPrompt: "A sprinter leaping forward off the blocks before the starter pistol fires, still smoking gun, track and field" },
  { id: 13, phrase: "Kick the bucket",             hint: "To die",                                              difficulty: "easy",   visualPrompt: "A foot mid-kick launching a metal bucket into the air, motion blur, simple background" },
  { id: 14, phrase: "Cost an arm and a leg",       hint: "Very expensive",                                      difficulty: "easy",   visualPrompt: "A price tag showing an arm and a leg instead of dollar signs on a fancy product, surreal illustration" },
  { id: 15, phrase: "Once in a blue moon",         hint: "Something that rarely happens",                       difficulty: "easy",   visualPrompt: "A bright blue full moon in a night sky, ethereal glow, long exposure photography" },
  { id: 16, phrase: "Kill two birds with one stone", hint: "Accomplish two things with one action",            difficulty: "easy",   visualPrompt: "A single stone suspended in mid-air between two cartoon birds, slapstick illustration" },
  { id: 17, phrase: "The ball is in your court",   hint: "The decision is now yours to make",                   difficulty: "easy",   visualPrompt: "A tennis ball resting on a painted court line, one half of the court highlighted in gold, aerial view" },
  { id: 18, phrase: "Hit the hay",                 hint: "To go to bed",                                        difficulty: "easy",   visualPrompt: "A person punching a hay bale on a farm, exaggerated impact, sunset barn background" },
  { id: 19, phrase: "Barking up the wrong tree",   hint: "Pursuing the wrong course of action",                 difficulty: "easy",   visualPrompt: "A dog sitting at the base of a tree, barking up at it, while a cat watches from a completely different tree" },
  { id: 20, phrase: "Cry over spilled milk",       hint: "To be upset about something that can't be changed",   difficulty: "easy",   visualPrompt: "A person dramatically crying next to a tipped glass of milk spreading across a white table" },
  { id: 21, phrase: "Let sleeping dogs lie",       hint: "Don't disturb a situation that is currently stable",  difficulty: "easy",   visualPrompt: "A dog sleeping peacefully on a rug, a person's hand stopping another from waking it, quiet scene" },
  { id: 22, phrase: "Break the ice",               hint: "To initiate social interaction",                      difficulty: "easy",   visualPrompt: "A small hammer smashing a block of clear ice at a party, cheerful setting, social gathering background" },
  { id: 23, phrase: "Butterflies in your stomach", hint: "Feeling nervous or excited",                          difficulty: "easy",   visualPrompt: "X-ray illustration showing colorful butterflies flying inside a human stomach silhouette, medical art style" },
  { id: 24, phrase: "Tip of the iceberg",          hint: "Only a small part of a larger problem is visible",    difficulty: "easy",   visualPrompt: "A massive iceberg with a tiny tip above the water and enormous bulk visible below, dramatic Arctic ocean" },
  { id: 25, phrase: "A fish out of water",         hint: "Someone uncomfortable in their environment",          difficulty: "easy",   visualPrompt: "A surprised fish in a suit and tie sitting at an office desk, photorealistic, absurdist style" },
  { id: 26, phrase: "Wild goose chase",            hint: "A futile search or pursuit",                          difficulty: "easy",   visualPrompt: "A person in running clothes chasing a goose through a field, chaotic, both in full sprint" },
  { id: 27, phrase: "Tie the knot",                hint: "To get married",                                      difficulty: "easy",   visualPrompt: "Two wedding rings tied together with a large decorative knot, white background, elegant photography" },
  { id: 28, phrase: "Over the moon",               hint: "Extremely happy or excited",                          difficulty: "easy",   visualPrompt: "A joyful person jumping high over a large full moon against a starry night sky, silhouette style" },
  { id: 29, phrase: "Add fuel to the fire",        hint: "Make a situation worse",                              difficulty: "easy",   visualPrompt: "A hand pouring gasoline onto roaring orange flames, action shot, dramatic fire photography" },
  { id: 30, phrase: "Bite off more than you can chew", hint: "Take on more than you can handle",               difficulty: "easy",   visualPrompt: "A person trying to bite an enormous oversized hamburger, mouth stretched wide, exaggerated" },
  { id: 31, phrase: "On thin ice",                 hint: "In a risky or precarious situation",                  difficulty: "easy",   visualPrompt: "A nervous person tiptoeing on cracking thin ice over dark water, cracks spreading under their feet" },
  { id: 32, phrase: "Beat around the bush",        hint: "Avoid getting to the main point",                     difficulty: "easy",   visualPrompt: "A person repeatedly hitting the branches of a bush with a stick, avoiding the center, whimsical" },
  { id: 33, phrase: "Burn the midnight oil",       hint: "Work late into the night",                            difficulty: "easy",   visualPrompt: "An oil lamp burning brightly on a desk at night, books and papers scattered, dim room, atmospheric" },
  { id: 34, phrase: "Hit the sack",                hint: "Go to bed / go to sleep",                             difficulty: "easy",   visualPrompt: "A person dramatically punching a burlap sack hanging in a bedroom doorway, bedtime setting" },
  { id: 35, phrase: "Cat got your tongue",         hint: "Why are you not speaking?",                           difficulty: "easy",   visualPrompt: "A cat holding a human tongue in its paws, surreal illustration, close-up, surprised expression" },

  // ── Medium ────────────────────────────────────────────────────────────────
  { id: 36, phrase: "Don't judge a book by its cover", hint: "Don't form opinions on appearances alone",        difficulty: "medium", visualPrompt: "An ugly, torn book cover opened to reveal stunning golden illustrated pages inside, dramatic contrast" },
  { id: 37, phrase: "Beat a dead horse",           hint: "Keep going over something already decided",           difficulty: "medium", visualPrompt: "A cartoon figure hitting a horse sleeping on the ground with a stick, absurdist style" },
  { id: 38, phrase: "Between a rock and a hard place", hint: "Facing two equally bad choices",                 difficulty: "medium", visualPrompt: "A small person squeezed between two giant boulders, symbolic illustration, tight composition" },
  { id: 39, phrase: "Caught red-handed",           hint: "Caught in the act of doing something wrong",          difficulty: "medium", visualPrompt: "A person with both hands covered in bright red paint raised up, guilty expression, caught" },
  { id: 40, phrase: "On the fence",                hint: "Undecided about something",                           difficulty: "medium", visualPrompt: "A person literally sitting balanced on a wooden garden fence, arms out for balance, thinking pose" },
  { id: 41, phrase: "The last straw",              hint: "The final thing that makes a situation unbearable",   difficulty: "medium", visualPrompt: "A camel's back breaking under the weight of a single straw being placed on it, cartoon style" },
  { id: 42, phrase: "Sour grapes",                 hint: "Pretending not to want something you can't have",     difficulty: "medium", visualPrompt: "A cartoon person looking away from a beautiful grape cluster with a disapproving scowl, green grapes" },
  { id: 43, phrase: "Water under the bridge",      hint: "Something from the past that no longer matters",      difficulty: "medium", visualPrompt: "Water flowing steadily under a stone bridge, peaceful river scene, metaphorical, wide shot" },
  { id: 44, phrase: "Drop the ball",               hint: "Fail to meet a responsibility",                       difficulty: "medium", visualPrompt: "A person in business attire fumbling and dropping a large colorful ball, motion blur, disappointed expression" },
  { id: 45, phrase: "Face the music",              hint: "Accept the consequences of your actions",             difficulty: "medium", visualPrompt: "A sheepish person standing in front of a full orchestra on stage, all musicians staring at them expectantly" },
  { id: 46, phrase: "Go back to the drawing board", hint: "Start over from the beginning",                     difficulty: "medium", visualPrompt: "A person erasing their elaborate plans from a large drawing board, looking frustrated, studio" },
  { id: 47, phrase: "Jump on the bandwagon",       hint: "Follow a trend",                                      difficulty: "medium", visualPrompt: "Multiple people enthusiastically jumping onto a moving old-fashioned wooden bandwagon, crowded, festive" },
  { id: 48, phrase: "Keep your chin up",           hint: "Stay positive in a difficult situation",              difficulty: "medium", visualPrompt: "A sad person in rain, but physically lifting their chin up with their finger, symbolic gesture" },
  { id: 49, phrase: "Miss the boat",               hint: "Miss an opportunity",                                  difficulty: "medium", visualPrompt: "A person running desperately on a dock watching a ship sailing away just out of reach" },
  { id: 50, phrase: "Open a can of worms",         hint: "Create a complicated situation",                      difficulty: "medium", visualPrompt: "A tin can being opened releasing dozens of wriggling worms in all directions, dramatic, chaotic" },
  { id: 51, phrase: "Paint the town red",          hint: "Go out and have a great time",                        difficulty: "medium", visualPrompt: "A person painting the walls and buildings of a city red with a giant paintbrush, bird's-eye view, vibrant" },
  { id: 52, phrase: "Put all your eggs in one basket", hint: "Rely entirely on one plan or option",            difficulty: "medium", visualPrompt: "A mountain of fragile eggs all crammed into one single small basket, teetering dangerously, close-up" },
  { id: 53, phrase: "Rock the boat",               hint: "Cause trouble or disrupt a stable situation",         difficulty: "medium", visualPrompt: "A person standing in a small rowboat vigorously rocking it back and forth, waves splashing, others alarmed" },
  { id: 54, phrase: "Roll with the punches",       hint: "Adapt to difficult situations",                       difficulty: "medium", visualPrompt: "A boxer calmly dodging and rolling away from multiple simultaneous punches, graceful, action photography" },
  { id: 55, phrase: "See eye to eye",              hint: "Agree with someone",                                   difficulty: "medium", visualPrompt: "Two people standing very close facing each other, their eyes perfectly level and aligned, symbolic close-up" },
  { id: 56, phrase: "Throw in the towel",          hint: "Give up or admit defeat",                             difficulty: "medium", visualPrompt: "A white towel being thrown into a boxing ring in slow-motion, dramatic lighting, empty ring" },
  { id: 57, phrase: "Up in the air",               hint: "Undecided or uncertain",                              difficulty: "medium", visualPrompt: "Multiple question marks and floating objects suspended in a clear blue sky, conceptual photo illustration" },
  { id: 58, phrase: "Walking on eggshells",        hint: "Being very careful not to upset someone",             difficulty: "medium", visualPrompt: "A person barefoot tiptoeing very carefully across a floor completely covered in raw eggs, tense expression" },
  { id: 59, phrase: "Apple of my eye",             hint: "Someone who is cherished above all others",           difficulty: "medium", visualPrompt: "A bright red apple with a reflective eye illustrated on it, warm lighting, love symbolism" },
  { id: 60, phrase: "Bend over backwards",         hint: "Try very hard to help someone",                       difficulty: "medium", visualPrompt: "A cartoon character dramatically bending over backwards in an extreme backbend to help someone, exaggerated" },
  { id: 61, phrase: "Born with a silver spoon",    hint: "Born into wealth and privilege",                       difficulty: "medium", visualPrompt: "A newborn baby in a hospital blanket with a silver spoon in their mouth, soft lighting, symbolic" },
  { id: 62, phrase: "Don't cry wolf",              hint: "Don't raise false alarms",                             difficulty: "medium", visualPrompt: "A boy shouting and pointing dramatically at a friendly dog mislabeled as a wolf, confused villagers" },
  { id: 63, phrase: "Storm in a teacup",           hint: "A great fuss over something trivial",                  difficulty: "medium", visualPrompt: "A tiny violent thunderstorm with lightning happening inside a dainty ceramic teacup, surreal macro photo" },
  { id: 64, phrase: "Strike while the iron is hot", hint: "Act at the most opportune moment",                  difficulty: "medium", visualPrompt: "A blacksmith's hammer striking a glowing orange-hot iron on an anvil, dramatic sparks flying, forge" },
  { id: 65, phrase: "The whole nine yards",        hint: "Everything, the full amount",                          difficulty: "medium", visualPrompt: "A tape measure showing exactly nine yards unrolled across a large space, symbolic measurement" },
  { id: 66, phrase: "On the ball",                 hint: "Alert and knowledgeable",                              difficulty: "medium", visualPrompt: "A confident person standing balanced on top of a large sphere/ball, arms crossed, smiling" },
  { id: 67, phrase: "Pull someone's leg",          hint: "Joke or tease someone",                                difficulty: "medium", visualPrompt: "One person playfully tugging on another person's trouser leg, both laughing, playful scene" },
  { id: 68, phrase: "Sit tight",                   hint: "Wait calmly without doing anything",                   difficulty: "medium", visualPrompt: "A person sitting very still with a vice/clamp holding them firmly to a chair, relaxed expression, metaphorical" },
  { id: 69, phrase: "Cut corners",                 hint: "Do something the easy way, sacrificing quality",       difficulty: "medium", visualPrompt: "A pair of scissors cutting the corners off multiple documents at once, shortcuts visible, business setting" },
  { id: 70, phrase: "Draw a blank",                hint: "Fail to remember or think of something",              difficulty: "medium", visualPrompt: "A confused person staring at a completely empty blank white canvas on an easel, pen in hand, stumped" },
  { id: 71, phrase: "Run out of steam",            hint: "Lose energy or enthusiasm",                            difficulty: "medium", visualPrompt: "A steam locomotive completely stopped with no steam at all coming from it, tracks ahead, empty sky" },
  { id: 72, phrase: "Spitting image",              hint: "An exact copy or resemblance of someone",              difficulty: "medium", visualPrompt: "Two identical twins standing side by side with one spitting mirror-image style, surreal photography" },
  { id: 73, phrase: "Step on someone's toes",      hint: "Interfere with someone's responsibilities",            difficulty: "medium", visualPrompt: "A person accidentally stepping on someone else's feet, both wincing, symbolic body language" },
  { id: 74, phrase: "Under the gun",               hint: "Under pressure to meet a deadline",                    difficulty: "medium", visualPrompt: "A person at a desk working frantically with a large gun barrel pointing at them from above, pressure metaphor" },
  { id: 75, phrase: "Time flies",                  hint: "Time passes very quickly",                             difficulty: "medium", visualPrompt: "A clock with wings flying through a blue sky, motion blur, whimsical illustration style" },

  // ── Hard ──────────────────────────────────────────────────────────────────
  { id: 76, phrase: "Read between the lines",      hint: "Find the hidden meaning",                              difficulty: "hard",   visualPrompt: "Magnifying glass revealing hidden text glowing between the lines of a printed page, detective noir lighting" },
  { id: 77, phrase: "The pot calling the kettle black", hint: "Accusing others of faults you have yourself",   difficulty: "hard",   visualPrompt: "An angry cooking pot pointing at a kettle, both jet black, kitchen setting, cartoon illustration" },
  { id: 78, phrase: "Every cloud has a silver lining", hint: "Every bad situation has some good in it",         difficulty: "hard",   visualPrompt: "A dark storm cloud with a bright silver glowing edge/lining, backlit by sunlight, dramatic sky photography" },
  { id: 79, phrase: "Crocodile tears",             hint: "Fake or insincere expressions of sadness",            difficulty: "hard",   visualPrompt: "A large crocodile crying dramatic oversized tears, theatrical sad expression, illustrated style" },
  { id: 80, phrase: "Leave no stone unturned",     hint: "Try every possible course of action",                 difficulty: "hard",   visualPrompt: "Many stones in a field all flipped over and turned, with one person methodically turning the last one" },
  { id: 81, phrase: "Lose your marbles",           hint: "Go crazy or lose your mind",                          difficulty: "hard",   visualPrompt: "A confused person with glass marbles rolling and falling out of their head, surreal illustration" },
  { id: 82, phrase: "On thin ice",                 hint: "In a risky situation",                                 difficulty: "hard",   visualPrompt: "A person standing on nearly transparent cracking ice over dark water, spider-web cracks under feet" },
  { id: 83, phrase: "Play devil's advocate",       hint: "Argue a position you don't believe to test it",       difficulty: "hard",   visualPrompt: "A person in a suit with small devil horns standing in a courtroom making an argument, dramatic lighting" },
  { id: 84, phrase: "Raise the bar",               hint: "Set a higher standard",                               difficulty: "hard",   visualPrompt: "Hands physically lifting a gold horizontal bar higher up its two standards, athletic competition setting" },
  { id: 85, phrase: "Take a raincheck",            hint: "Decline now but accept later",                         difficulty: "hard",   visualPrompt: "A hand holding a paper raincheck ticket up toward rain clouds, symbolic refusal, retro illustration style" },
  { id: 86, phrase: "The devil is in the details", hint: "Small details can cause big problems",                 difficulty: "hard",   visualPrompt: "A tiny devil character hidden inside small printed text on a contract, magnifying glass reveals it" },
  { id: 87, phrase: "Throw caution to the wind",   hint: "Act in a reckless manner",                            difficulty: "hard",   visualPrompt: "A person throwing a sign labeled CAUTION into a strong wind, papers flying everywhere, dramatic storm" },
  { id: 88, phrase: "Kick the habit",              hint: "Stop doing something harmful",                         difficulty: "hard",   visualPrompt: "A foot kicking a chain made of habit loops, symbolic chain breaking, clean graphic illustration" },
  { id: 89, phrase: "Miss the mark",               hint: "Fail to achieve the desired result",                   difficulty: "hard",   visualPrompt: "An arrow hitting a target board but clearly missing the bullseye, landing in outer rings, archery" },
  { id: 90, phrase: "Run circles around",          hint: "Easily outperform someone",                            difficulty: "hard",   visualPrompt: "One fast runner lapping another runner multiple times, circular track, bird's-eye view" },
  { id: 91, phrase: "Hang in there",               hint: "Keep persevering",                                     difficulty: "hard",   visualPrompt: "A cat clinging to a bar hanging by its paws with a determined face, motivational poster style" },
  { id: 92, phrase: "Have a ball",                 hint: "Enjoy yourself immensely",                             difficulty: "hard",   visualPrompt: "People dressed elegantly dancing and laughing at a formal ball event, chandelier, glamorous ballroom" },
  { id: 93, phrase: "Jump to conclusions",         hint: "Make a hasty judgment",                                difficulty: "hard",   visualPrompt: "A person mid-leap jumping toward large letters spelling CONCLUSION on the ground, action shot" },
  { id: 94, phrase: "Hit the ground running",      hint: "Start something energetically and quickly",            difficulty: "hard",   visualPrompt: "An athlete the instant their foot touches the ground in full sprint, starting position, determination" },
  { id: 95, phrase: "Bend over backwards",         hint: "Go to great lengths to help",                          difficulty: "hard",   visualPrompt: "An acrobat performing an extreme backward bend, representing extraordinary effort, gymnast silhouette" },
  { id: 96, phrase: "Keep at bay",                 hint: "Keep under control or at a distance",                  difficulty: "hard",   visualPrompt: "A person using a torch to keep dangerous wolves at a distance in the dark woods, dramatic night scene" },
  { id: 97, phrase: "At the drop of a hat",        hint: "Immediately without hesitation",                       difficulty: "hard",   visualPrompt: "A hat falling from a hand toward the ground, below the hat a person already in mid-sprint, action shot" },
  { id: 98, phrase: "Back to the drawing board",   hint: "Start over with a new plan",                           difficulty: "hard",   visualPrompt: "A large drafting board with all plans erased except a small cursor blinking, clean slate, architecture studio" },
  { id: 99, phrase: "Shoot the breeze",            hint: "Have a casual conversation",                           difficulty: "hard",   visualPrompt: "A person pointing a toy gun at moving air currents visualized as colorful wisps, whimsical illustration" },
  { id: 100, phrase: "Bite the dust",              hint: "Fail or be defeated",                                  difficulty: "hard",   visualPrompt: "A cartoon character face-down on a dusty road mouth full of dirt, western setting, exaggerated style" },
];

/** Returns a random idiom from the full list. */
export function pickRandomIdiom(): BenchmarkIdiom {
  return BENCHMARK_IDIOMS[Math.floor(Math.random() * BENCHMARK_IDIOMS.length)];
}

/** Returns a random idiom by difficulty. */
export function pickIdiomByDifficulty(difficulty: IdiomDifficulty): BenchmarkIdiom {
  const pool = BENCHMARK_IDIOMS.filter(i => i.difficulty === difficulty);
  return pool[Math.floor(Math.random() * pool.length)];
}
