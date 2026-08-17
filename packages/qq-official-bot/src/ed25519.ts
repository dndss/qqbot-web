/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
import { ed25519 } from '@noble/curves/ed25519';

export class Ed25519 {
    #privateKey: Buffer
    get #publicKey(){
        return ed25519.getPublicKey(this.#privateKey)
    }
    constructor(secret: string) {
        while (secret.length < 32) secret = secret.repeat(2);
        secret = secret.slice(0, 32);
        this.#privateKey=Buffer.from(secret)
    }
    sign(message: string) {
        const content=Buffer.from(message,'utf8').toString('hex')
        const signResult=ed25519.sign(content, this.#privateKey)
        return Buffer.from(signResult.buffer).toString('hex')
    }
    verify(signature:string, message: string) {
        return ed25519.verify(signature, Buffer.from(message,'utf8'), this.#publicKey)
    }
}

/**
 * ed25519 curve with EdDSA signatures.
 */
export default ed25519
