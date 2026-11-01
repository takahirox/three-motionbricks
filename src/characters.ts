export interface CharacterResource {reset(): void; dispose(): void}
/** Loading can finish after another selection. Only the newest request can own
 * the scene; stale loads are disposed and a failed load leaves SOMA active. */
export class CharacterSelection<T extends CharacterResource> {
  private revision = 0;
  current?: T;
  constructor(private changed: (character?: T) => void) {}
  async select(load?: () => Promise<T>): Promise<boolean> {
    const revision = ++this.revision;
    this.current?.dispose(); this.current = undefined; this.changed();
    if (!load) return true;
    let resource: T;
    try {resource = await load();}
    catch (error) {if (revision !== this.revision) return false; throw error;}
    if (revision !== this.revision) {resource.dispose(); return false;}
    resource.reset(); this.current = resource; this.changed(resource); return true;
  }
  dispose() {this.revision++; this.current?.dispose(); this.current = undefined;}
}
