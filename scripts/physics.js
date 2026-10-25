
/**
 * @author Seabird S. Gunnhildr
 * 
 * This file features front-end physics calculations.
 */

/**
 * 
 * @param {number} value 
 * @param {number} unit 
 * @returns {number}
 */
function roundTo(value, unit) {
    return Math.round(value * unit) / unit;
}

export function InHgToKPa(inhg) {
    return inhg * 33.8638;
}

export function correctAltitude(origin, newPress, basePress = 1013.25) {
    const originPress = basePress * Math.pow(1 - (0.0065 * origin) / 288.15, 5.255);
    return (1 - Math.pow(originPress / newPress, 1 / 5.255)) * 288.15 / 0.0065;
}

export class AirspeedCalculator {

    /**
     * 
     * @param {number} tat Total air temperature. (Celcius)
     */
    constructor(tat) {
        this.tat = tat;
        this.k = 1.4;
        this.R = 287;
    }

    /**
     * @returns {number} Sound speed (m/s).
     */
    a() {
        return Math.sqrt((this.tat + 273.15) * this.k * this.R);
    }

    /**
     * 
     * @param {number} tasKnots TAS from backend (knots).
     * @returns {number} Mach number.
     */
    mach(tasKnots) {
        return (tasKnots * 1.852 / 3.6) / this.a();
    }
}