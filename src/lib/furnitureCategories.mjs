export const FURNITURE_CATEGORIES=[
 ['all','All models','همه مدل‌ها',null],['sofas','Sofas & armchairs','مبل و کاناپه',['sofa','armchair']],
 ['cabinets','Cabinets & wardrobes','کابینت و کمد',['cabinet','cabinet_door','wardrobe']],
 ['beds','Beds','تخت خواب',['bed','nightstand']],['dining','Dining tables','میز غذاخوری',['dining_table']],
 ['tables','Tables & desks','میز و میز کار',['coffee_table','desk','dressing_table']],['chairs','Chairs','صندلی',['chair']],
 ['curtains','Curtains & blinds','پرده',['curtain']],['rugs','Rugs','فرش و قالیچه',['rug']],
 ['lighting','Lighting','روشنایی',['floor_lamp']],['plants','Plants','گیاهان',['plant','flower_pot']],
 ['kitchen','Kitchen & appliances','آشپزخانه و لوازم',['kitchen_counter','kitchen_island','range_hood','stove','refrigerator','freezer','washing_machine']],
 ['bathroom','Bathroom','حمام و سرویس',['toilet','sink','shower','bathtub']],['other','TV & mirrors','تلویزیون و آینه',['tv_unit','mirror']],
 ['doors','Doors','در',[]],['windows','Windows','پنجره',[]],
].map(([id,en,fa,types])=>({id,en,fa,ar:en,types}));
export function filterFurniture(catalog,category='all',query=''){
 const c=FURNITURE_CATEGORIES.find(c=>c.id===category);if(!c)return [];
 const q=query.trim().toLocaleLowerCase();return catalog.filter(m=>(!c.types||c.types.includes(m.type))&&(!q||[m.en,m.fa,m.ar].some(s=>s?.toLocaleLowerCase().includes(q))));
}
