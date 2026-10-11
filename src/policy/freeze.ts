/** Called only on validated owned data; never invokes accessors. */
export function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      if ('value' in descriptor) freezeData(descriptor.value);
    }
    Object.freeze(value);
  }
  return value;
}
