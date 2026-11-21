/**
 * All user-facing English strings. Add a new locale by copying this file and
 * exporting it from src/strings/index.ts. Use {name} placeholders with `fmt`.
 */
export const en = {
  app: {
    name: 'Library Card',
    shortName: 'Library Card',
    description: 'A reading tracker for kids with QR library cards.',
  },

  common: {
    loading: 'Loading…',
    retry: 'Try again',
    cancel: 'Cancel',
    unknownAuthor: 'Unknown author',
    byAuthors: 'by {authors}',
    coverAlt: 'Cover of {title}',
  },

  home: {
    title: 'Library Card',
    tagline: 'Scan, read, and climb your reading journey.',
    comingSoon: 'The reader app is on its way. For now, try the developer page.',
    openDev: 'Open developer page',
  },

  scanner: {
    starting: 'Starting camera…',
    hint: 'Point the camera at a barcode',
    torchOn: 'Turn light on',
    torchOff: 'Turn light off',
    errorPermission: 'Camera access was blocked. Allow the camera in your browser settings, then try again.',
    errorNoCamera: 'No camera was found on this device.',
    errorInUse: 'The camera is being used by another app.',
    errorInsecure: 'The camera needs a secure (https) connection.',
    errorUnsupported: 'This browser cannot use the camera.',
    errorGeneric: 'The camera could not start.',
    videoLabel: 'Camera preview',
  },

  lookup: {
    invalidIsbn: 'That doesn’t look like a book barcode (ISBN).',
    notFound: 'We couldn’t find that book. ISBN {isbn}',
    network: 'Couldn’t reach the book catalogue. Check your connection and try again.',
    searching: 'Looking up {isbn}…',
  },

  dev: {
    title: 'Developer page',
    intro: 'Scan a book’s barcode, check the match, then add it to the Home library.',
    adapter: 'Storage adapter: {name}',
    startScan: 'Scan a book',
    stopScan: 'Stop camera',
    manualLabel: 'Or type an ISBN',
    manualPlaceholder: '978…',
    manualSubmit: 'Look up',
    addToHome: 'Add to Home',
    added: 'Added to Home',
    alreadyInHome: 'Already in Home',
    remove: 'Remove',
    scanAnother: 'Scan another',
    homeHeading: 'Home library ({count})',
    homeEmpty: 'No books yet. Scan one to get started.',
    defaultHouseholdName: 'My household',
    storageError: 'Storage is unavailable: {message}',
    back: 'Back',
  },

  journeys: {
    ocean_deep: {
      title: 'Ocean Deep',
      stages: ['Sunny shallows', 'Kelp forest', 'Twilight zone', 'Midnight zone', 'The ocean floor'],
    },
    redwood_tree: {
      title: 'Redwood Tree',
      stages: ['Forest floor', 'Lowest branch', 'Squirrel nest', 'Above the fog', 'The treetop'],
    },
    ocean_cliff: {
      title: 'Ocean Cliff',
      stages: ['Rocky beach', 'Tide pools', 'Seabird ledges', 'Windy path', 'Clifftop lighthouse'],
    },
    skyscraper: {
      title: 'Skyscraper',
      stages: ['Lobby', 'Tenth floor', 'Sky lobby', 'Observation deck', 'The spire'],
    },
    rapunzel_tower: {
      title: 'Rapunzel’s Tower',
      stages: ['Tower door', 'Winding stairs', 'Ivy window', 'Braid ladder', 'Tower room'],
    },
    hot_air_balloon: {
      title: 'Hot-Air Balloon',
      stages: ['Lift off', 'Over the fields', 'Through the clouds', 'Chasing birds', 'High above the world'],
    },
    ladder_to_the_moon: {
      title: 'Ladder to the Moon',
      stages: ['Bottom rung', 'Rooftops', 'Above the clouds', 'Among the stars', 'The moon'],
    },
    rocket_through_space: {
      title: 'Rocket Through Space',
      stages: ['Launch pad', 'Orbit', 'Past the moon', 'Asteroid belt', 'A new planet'],
    },
  },
} as const;

export type Strings = typeof en;
