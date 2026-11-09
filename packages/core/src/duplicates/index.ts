export {
  mainFilePath,
  normalizeBody,
  bodyFingerprint,
  mainFileFingerprint,
  artifactBodyFingerprint,
} from "./fingerprint.ts";
export { STOP_WORDS, descriptionWords, jaccard, descriptionSimilarity } from "./words.ts";
export { BACKUP_SUFFIXES, isBackupRoot } from "./backup.ts";
