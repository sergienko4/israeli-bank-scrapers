/**
 * Barrel of every bank shape reachable through the API-direct scrape phase.
 *
 * The window-narrowing contract needs all sixteen shapes in one place. Listing
 * them here rather than in the contract's own fixtures keeps that file inside
 * the repo's fifteen-dependency module cap, and gives the list a single home
 * that a review can read top to bottom.
 *
 * The list is explicit rather than derived: no registry of shapes exists, and a
 * shape only reaches the wire through its pipeline builder, so there is nothing
 * to enumerate. An explicit list makes a forgotten bank a visible omission in
 * review, and the contract asserts the count to make it a failing test too.
 */

export { AMEX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Amex/scrape/AmexShape.js';
export { BEINLEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Beinleumi/scrape/BeinleumiShape.js';
export { DISCOUNT_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Discount/scrape/DiscountShape.js';
export { HAPOALIM_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Hapoalim/scrape/HapoalimShape.js';
export { ISRACARD_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Isracard/scrape/IsracardShape.js';
export { LEUMI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Leumi/scrape/LeumiShape.js';
export { MASSAD_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Massad/scrape/MassadShape.js';
export { MAX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Max/scrape/MaxShape.js';
export { MERCANTILE_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Mercantile/scrape/MercantileShape.js';
export { ONE_ZERO_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/OneZero/scrape/OneZeroShape.js';
export { OTSAR_HAHAYAL_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/OtsarHahayal/scrape/OtsarHahayalShape.js';
export { PAGI_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Pagi/scrape/PagiShape.js';
export { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
export { PEPPER_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShape.js';
export { VISACAL_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/VisaCal/scrape/VisaCalShape.js';
export { YAHAV_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/Yahav/scrape/YahavShape.js';
