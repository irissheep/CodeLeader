import fs from 'node:fs/promises';

export async function readCorpusLayers(publicFile, privateFile) {
  const read = file => fs.readFile(file, 'utf8').then(JSON.parse);
  const publicManifest = await read(publicFile);
  if (!Array.isArray(publicManifest.projects)) throw Error('Invalid public corpus manifest');
  let privateManifest;
  try {
    privateManifest = await read(privateFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {publicProjects: publicManifest.projects, privateProjects: [], privateMissing: true};
  }
  if (!Array.isArray(privateManifest.projects)) throw Error('Invalid private corpus manifest');
  const publicIds = new Set(publicManifest.projects.map(project => project.id));
  if (privateManifest.projects.some(project => publicIds.has(project.id))) throw Error('Public and private corpus IDs overlap');
  return {publicProjects: publicManifest.projects, privateProjects: privateManifest.projects, privateMissing: false};
}
