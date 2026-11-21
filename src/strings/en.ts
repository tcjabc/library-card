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
    close: 'Close',
    saving: 'Saving…',
    unknownAuthor: 'Unknown author',
    byAuthors: 'by {authors}',
    coverAlt: 'Cover of {title}',
    backToHub: 'Back',
  },

  data: {
    defaultHouseholdName: 'My household',
  },

  splash: {
    title: 'Scan your library card!',
    subtitle: 'Hold your card up to the camera.',
    notACard: 'Hmm, that’s not a library card. Try your card’s square code!',
    grownUps: 'Grown-ups',
  },

  card: {
    checking: 'Checking your card…',
    unknownTitle: 'We don’t know this card',
    unknownBody: 'This card isn’t on this device. Ask a grown-up to help, or try scanning again.',
    unknownError: 'Something went wrong reading this card. Please try again.',
    scanAgain: 'Scan again',
  },

  hub: {
    greeting: 'Hi, {name}!',
    navLabel: 'Places to go',
    shelf: 'My Bookshelf',
    library: 'Library Books',
    journey: 'My Journey',
    staircase: 'Family Staircase',
    familyReads: '{count} books read together',
    familyReadsOne: '1 book read together',
    notMe: 'Not you? Scan your card',
  },

  comingSoon: {
    body: 'Coming soon! Keep reading and check back.',
    staircaseCount: 'books read by your family so far',
    staircaseCountOne: 'book read by your family so far',
  },

  shelf: {
    title: 'My Bookshelf',
    filterLabel: 'Show books',
    filterAll: 'All ({count})',
    filterRead: 'Read ({count})',
    filterUnread: 'Not read ({count})',
    readOff: 'I read this!',
    readOn: 'I read it!',
    readLabelOff: 'Mark {title} as read',
    readLabelOn: '{title} is read. Tap to unmark',
    markedToast: 'Hooray! You read {title}!',
    unmarkedToast: '{title} is not marked as read',
    undo: 'Undo',
    saveError: 'Oops, that didn’t save. Please try again.',
    thisBook: 'this book',
    emptyAll: 'No books on the shelf yet. Ask a grown-up to add some!',
    emptyRead: 'No books read yet. Pick one and start reading!',
    emptyUnread: 'You’ve read every book on the shelf. Amazing!',
  },

  bookSheet: {
    titleNew: 'Add a book',
    titleAddCover: 'Add a cover photo',
    titleFix: 'Fix this book',
    introNew: 'We couldn’t find this book, so let’s add it by hand.',
    introAddCover: 'We found the book but not its cover. Take a photo of the front.',
    isbn: 'ISBN {isbn}',
    untitled: 'New book',
    addPhoto: 'Add a cover photo',
    changePhoto: 'Change cover photo',
    photoHint: 'Take a photo of the front cover, or choose one.',
    photoError: 'That photo couldn’t be used. Try another one.',
    titleLabel: 'Title (required)',
    titleRequired: 'Please add the book’s title.',
    authorLabel: 'Author',
    authorPlaceholder: 'Separate several authors with commas',
    save: 'Save',
    saveError: 'The book couldn’t be saved. Please try again.',
  },

  scanner: {
    starting: 'Starting camera…',
    hint: 'Point the camera at a barcode',
    otherBarcode: 'Try the other barcode, near the price!',
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
    title: 'Grown-up tools',
    intro: 'Temporary tools for setting up readers and books. A PIN-protected grown-up area replaces this page later.',
    adapter: 'Storage adapter: {name}',
    back: 'Back',
    storageError: 'Storage is unavailable: {message}',

    readersHeading: 'Readers and library cards',
    readerName: 'Name',
    readerNamePlaceholder: 'First name or nickname',
    readerAvatar: 'Pick an avatar',
    createReader: 'Create reader',
    readerCreated: 'Created {name}',
    noReaders: 'No readers yet. Create one to get a library card.',
    qrAlt: 'Library card QR code for {name}',
    openCard: 'Open card',
    rotateToken: 'New card code',
    tokenRotated: '{name} has a new card. The old one no longer works.',

    addHeading: 'Add books to Home',
    startScan: 'Scan a book',
    stopScan: 'Stop camera',
    scanAnother: 'Scan another',
    manualLabel: 'Or type an ISBN',
    manualPlaceholder: '978…',
    manualSubmit: 'Look up',
    addManually: 'Add by hand',
    addToHome: 'Add to Home',
    alreadyInHome: 'Already in Home',
    addedToast: 'Added {title} to Home',
    fixedToast: 'Saved {title}',

    homeHeading: 'Home library ({count})',
    homeEmpty: 'No books yet. Scan one to get started.',
    fixBook: 'Fix this book',
    remove: 'Remove',

    selfTestHeading: 'Storage self-test',
    selfTestIntro: 'Checks the local storage adapter against a throwaway database. Your data is not touched.',
    selfTestRun: 'Run self-test',
    selfTestRunning: 'Running…',
    selfTestSummary: '{passed} of {total} checks passed',
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
