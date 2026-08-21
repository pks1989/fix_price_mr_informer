import fs from 'node:fs';
import path from 'node:path';

function readState(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { mrs: {}, users: {} };
    }
    throw err;
  }
}

function writeState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, filePath);
}

function createStore(filePath) {
  return {
    getMr(mrKey) {
      return readState(filePath).mrs[mrKey] ?? null;
    },
    setMr(mrKey, value) {
      const state = readState(filePath);
      state.mrs[mrKey] = value;
      writeState(filePath, state);
    },
    deleteMr(mrKey) {
      const state = readState(filePath);
      delete state.mrs[mrKey];
      writeState(filePath, state);
    },
    getAllMrKeys() {
      return Object.keys(readState(filePath).mrs);
    },
    setUser(chatId, gitlabUsername) {
      const state = readState(filePath);
      state.users[String(chatId)] = gitlabUsername;
      writeState(filePath, state);
    },
    getChatIdForGitlabUser(gitlabUsername) {
      const state = readState(filePath);
      const entry = Object.entries(state.users).find(([, username]) => username === gitlabUsername);
      return entry ? Number(entry[0]) : null;
    },
  };
}

export { createStore };
