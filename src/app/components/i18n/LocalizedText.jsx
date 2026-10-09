'use client';import {Children,Fragment} from 'react';import {useLanguage} from './LanguageProvider';import {translateText} from '@/lib/i18n/translate.mjs';
export default function LocalizedText({children}){const {language}=useLanguage();return <>{Children.toArray(children).map((child,i)=>typeof child==='string'?<Fragment key={i}>{translateText(child,language)}</Fragment>:child)}</>;}
