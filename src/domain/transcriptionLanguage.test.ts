import {expect,it} from 'vitest';
import {transcriptionLanguageForLocale,transcriptionLanguages} from './transcriptionLanguage';
it('uses visitor language as the source-language hint with Japanese fallback',()=>{
 expect(['ja-JP','zh-CN','zh-TW','en-US','ko-KR','unknown'].map(transcriptionLanguageForLocale)).toEqual(['ja','zh','zh','en','ko','ja']);
 expect(transcriptionLanguages.slice(0,4).map(l=>l.code)).toEqual(['ja','zh','en','ko']);
 expect(transcriptionLanguages.some(l=>l.code==='es')).toBe(true);
 expect(transcriptionLanguages.some(l=>l.code==='auto')).toBe(true);
});
