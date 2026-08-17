import {BinaryLike, createHash} from "crypto";

/** md5 hash */
export const md5 = (data: BinaryLike) => createHash("md5").update(data).digest().toString('hex');
