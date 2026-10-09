'use client';
import Link from 'next/link';import LocalizedElement from './LocalizedElement';
export default function LocalizedLink(props){return <LocalizedElement as={Link} {...props}/>;}
