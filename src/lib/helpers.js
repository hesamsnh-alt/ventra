export function formatCurrency(number){

return new Intl.NumberFormat(

"en-AE",

{

style:"currency",

currency:"AED",

maximumFractionDigits:0,

}

).format(number);

}