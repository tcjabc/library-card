import { describe, expect, it } from 'vitest';
import { fixLowercaseTitle, isAllLowercase, toTitleCase } from '../text';

describe('isAllLowercase', () => {
  it('is true only for Latin text with no capitals', () => {
    expect(isAllLowercase("charlotte's web")).toBe(true);
    expect(isAllLowercase('Charlotte’s web')).toBe(false);
    expect(isAllLowercase('小王子')).toBe(false); // no Latin letters at all
    expect(isAllLowercase('1984')).toBe(false);
  });
});

describe('toTitleCase', () => {
  it.each([
    ["charlotte's web", "Charlotte's Web"],
    ["harry potter and the sorcerer's stone", "Harry Potter and the Sorcerer's Stone"],
    ['the lion, the witch and the wardrobe', 'The Lion, the Witch and the Wardrobe'],
    ['a tale of two cities: the end of an era', 'A Tale of Two Cities: The End of an Era'],
    ['mr. men: little miss sunshine', 'Mr. Men: Little Miss Sunshine'],
    ['spider-man and friends', 'Spider-Man and Friends'],
    ['where the wild things are', 'Where the Wild Things Are'],
    ['what is it for', 'What Is It For'], // a minor word at the end is capitalised
    ['  of mice and men  ', 'Of Mice and Men'],
  ])('%s -> %s', (input, expected) => {
    expect(toTitleCase(input)).toBe(expected);
  });
});

describe('fixLowercaseTitle', () => {
  it('only changes titles that arrived entirely lowercase', () => {
    expect(fixLowercaseTitle("charlotte's web")).toBe("Charlotte's Web");
    expect(fixLowercaseTitle('The three voices of poetry')).toBe('The three voices of poetry');
    expect(fixLowercaseTitle('小王子')).toBe('小王子');
  });
});
