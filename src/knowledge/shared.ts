import { verifiedOn } from './define.ts';
import type { SharedKnowledge } from './types.ts';

const { verified } = verifiedOn('2026-11-06');

const SPECIFICATION = 'https://agentskills.io/specification';

// Tag v1.7.6, the gitHead of skills@1.7.6, the latest version on npm on 2026-11-06.
const SKILLS_V1_7_6 = 'https://github.com/vercel-labs/skills/blob/7a5e920bead4b1039a6d6df5d7e1163b7b09423a/src';

export const shared: SharedKnowledge = {
  skillFormat: verified(
    {
      entryFile: 'SKILL.md',
      requiredFields: ['name', 'description'],
      optionalFields: ['license', 'compatibility', 'metadata', 'allowed-tools'],
      bundledDirectories: ['scripts', 'references', 'assets'],
    },
    SPECIFICATION,
    'The bundled directories are conventions: a skill may hold any other files and directories, so they do not bound where executable code can be. allowed-tools is a space-separated string, marked experimental, and support varies between agents. name must match the parent directory.',
  ),
  skillsLock: verified(
    {
      file: 'skills-lock.json',
      versionField: 'version',
      skillsField: 'skills',
      entryFields: ['source', 'sourceUrl', 'ref', 'sourceType', 'skillPath', 'version', 'via', 'computedHash', 'subagents', 'wellKnownDigest', 'installMode'],
      hashField: 'computedHash',
      hashAlgorithm:
        'SHA-256, lowercase hex digest. Walk the folder recursively, skipping directories named .git or node_modules at any depth and every entry that is neither a directory nor a regular file, so symlinks are skipped. Each file path is relative to the skill folder with / separators. Sort by path with String.prototype.localeCompare and no locale argument. For each file in that order, feed the hash the UTF-8 bytes of the path, then the raw bytes of the content, with no separator or length prefix.',
    },
    `${SKILLS_V1_7_6}/local-lock.ts`,
    [
      'The file holds version 1 (other versions are refused) and a map of skill name to entry, sorted by name, written as JSON with 2-space indent and a final newline. source, sourceType and computedHash are required in an entry. experimental_install, which restores from this file, still carries the experimental name in v1.7.6.',
      `Hashing the installed folder does not always reproduce computedHash. Except for well-known sources, the hash is taken at the source, not from the installed copy (sourceSkillHash in ${SKILLS_V1_7_6}/add.ts), while the copy drops files named metadata.json, directories named __pycache__ or __pypackages__ and dereferences symlinks (copyDirectory in ${SKILLS_V1_7_6}/installer.ts). A skill with any of those can show a false mismatch.`,
      `Skills installed from a blob snapshot use computeSnapshotHash (${SKILLS_V1_7_6}/blob.ts): the same scheme over the snapshot's file list, whose contents are strings, and for a skill at the repository root only its SKILL.md. The default-locale sort can order paths differently between machines. The user-level lock is a different file (skill-lock.ts), whose skillFolderHash may be a GitHub tree SHA.`,
    ].join(' '),
  ),
};
