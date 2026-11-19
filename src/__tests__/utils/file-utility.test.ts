import { expect, spyOn, test } from 'bun:test';
import fs from 'node:fs';
import { loadMarkdownDirectory } from '../../utils/file-utility.js';

const PARSED_FILE_COUNT = 2;
const MARKDOWN_FILE_NAMES = ['guide.md', 'notes.txt', 'extra.md'] as unknown as ReturnType<
  typeof fs.readdirSync
>;

test('loadMarkdownDirectory returns parsed markdown files and ignores non-markdown names', () => {
  const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(MARKDOWN_FILE_NAMES);
  const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(
    ((target: unknown) =>
      String(target).endsWith('extra.md')
        ? '---\ntitle: extra\n---\nextra body'
        : '---\ntitle: guide\n---\nguide body') as unknown as typeof fs.readFileSync,
  );

  try {
    const parsed = loadMarkdownDirectory('some-directory');
    expect(parsed).toHaveLength(PARSED_FILE_COUNT);
    expect(parsed[0]!.data).toEqual({ title: 'guide' });
    expect(parsed[1]!.data).toEqual({ title: 'extra' });
  } finally {
    readFileSpy.mockRestore();
    readdirSpy.mockRestore();
  }
});

test('loadMarkdownDirectory returns an empty list when the directory cannot be read', () => {
  expect(loadMarkdownDirectory('owflow-no-such-directory')).toEqual([]);
});

test('loadMarkdownDirectory skips unreadable markdown files and continues parsing the rest', () => {
  const readdirSpy = spyOn(fs, 'readdirSync').mockReturnValue(['good.md', 'broken.md'] as unknown as ReturnType<
    typeof fs.readdirSync
  >);
  const readFileSpy = spyOn(fs, 'readFileSync').mockImplementation(((target: unknown) => {
    if (String(target).endsWith('broken.md')) {
      throw new Error('EISDIR: illegal operation on a directory');
    }
    return '---\ntitle: good\n---\ngood body';
  }) as unknown as typeof fs.readFileSync);

  try {
    const parsed = loadMarkdownDirectory('mixed-directory');
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.data).toEqual({ title: 'good' });
  } finally {
    readFileSpy.mockRestore();
    readdirSpy.mockRestore();
  }
});
