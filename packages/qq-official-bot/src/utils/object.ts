export const toObject = <T = any>(data: any) => {
    if (Buffer.isBuffer(data)) return JSON.parse(data.toString()) as T;
    if (typeof data === 'object') return data as T;
    if (typeof data === 'string') return JSON.parse(data) as T;
};
export function deepClone<T extends object>(obj: T) {
    if (typeof obj !== "object") return obj
    if (Array.isArray(obj)) return obj.map(deepClone)
    const Constructor = obj.constructor;
    let newObj: T = Constructor()
    for (let key in obj) {
        newObj[key] = deepClone(obj[key as any])
    }
    return newObj;
}
