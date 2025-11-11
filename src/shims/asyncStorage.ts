// Minimal shim for RN AsyncStorage so web builds don't require the native module
const AsyncStorage = {
  getItem: async (_key: string) => null as string | null,
  setItem: async (_key: string, _value: string) => {},
  removeItem: async (_key: string) => {},
  clear: async () => {},
  getAllKeys: async () => [] as string[],
  multiGet: async (_keys: string[]) => [] as [string, string | null][],
  multiSet: async (_pairs: [string, string][]) => {},
  multiRemove: async (_keys: string[]) => {},
}
export default AsyncStorage