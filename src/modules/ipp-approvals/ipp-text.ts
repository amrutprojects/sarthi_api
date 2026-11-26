/*
 * Text from outside, made safe to store and to show. PostgreSQL holds neither U+0000 nor half of a surrogate pair
 * (\p{Cs} with the u flag matches only a half); both can only come from broken input.
 */
export const storable = (v: string): string => v.replaceAll('\0', '').replace(/\p{Cs}/gu, String.fromCharCode(0xfffd));

/* What a person typed: without control characters (line breaks and tabs stay), trimmed. */
export const typedText = (v: string): string => v.replace(/[^\P{Cc}\n\r\t]|\p{Cs}/gu, '').trim();

/* A name on one line: without any control character, trimmed. */
export const oneLine = (v: string): string => v.replace(/\p{Cc}|\p{Cs}/gu, '').trim();
