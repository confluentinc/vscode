let kafkaClusters: string[] = [];
export function setKafkaClusters(clusters: string[]): void {
  kafkaClusters = clusters;
}
export function getKafkaClusters(): string[] {
  return kafkaClusters;
}

let topics: string[] = [];
export function setTopics(newTopics: string[]): void {
  topics = newTopics;
}
export function getTopics(): string[] {
  return topics;
}
