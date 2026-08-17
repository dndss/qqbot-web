import * as fs from 'fs'
import axios from 'axios'

export async function getBase64FromLocal(filepath:string){
    return (await fs.readFileSync(filepath.replace("file://", ""))).toString('base64')
}
export async function getBase64FromWeb(url:string){
    const res = await axios.get(url,{
        responseType:'arraybuffer'
    })
    return Buffer.from(res.data).toString('base64')
}
export function getFileBase64(file:string|Buffer){
    if(Buffer.isBuffer(file)) return file.toString('base64')
    if(file.startsWith('http')) return getBase64FromWeb(file)
    if(file.startsWith('base64://')) return file.replace('base64://', '')
    try { return getBase64FromLocal(file) } catch {}
    return file
}
