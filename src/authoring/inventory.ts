import { capabilityRegistry } from '../sandbox/capabilities';
import { freezeData } from '../policy/freeze';
export function capabilityInventory() {
  return freezeData(
    Object.entries(capabilityRegistry).map(([name, definition]) => {
      const split = name.indexOf('.');
      return {
        name,
        tool: name.slice(0, split),
        operation: name.slice(split + 1),
        effect: definition.effect,
      };
    }),
  );
}
