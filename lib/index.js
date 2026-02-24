"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "CompanyTypes", {
  enumerable: true,
  get: function () {
    return _definitions.CompanyTypes;
  }
});
Object.defineProperty(exports, "OneZeroScraper", {
  enumerable: true,
  get: function () {
    return _oneZero.default;
  }
});
Object.defineProperty(exports, "SCRAPERS", {
  enumerable: true,
  get: function () {
    return _definitions.SCRAPERS;
  }
});
Object.defineProperty(exports, "ScaperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScaperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "Scraper", {
  enumerable: true,
  get: function () {
    return _interface.Scraper;
  }
});
Object.defineProperty(exports, "ScraperCredentials", {
  enumerable: true,
  get: function () {
    return _interface.ScraperCredentials;
  }
});
Object.defineProperty(exports, "ScraperLoginResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperLoginResult;
  }
});
Object.defineProperty(exports, "ScraperOptions", {
  enumerable: true,
  get: function () {
    return _interface.ScraperOptions;
  }
});
Object.defineProperty(exports, "ScraperScrapingResult", {
  enumerable: true,
  get: function () {
    return _interface.ScraperScrapingResult;
  }
});
Object.defineProperty(exports, "createScraper", {
  enumerable: true,
  get: function () {
    return _factory.default;
  }
});
exports.getPuppeteerConfig = getPuppeteerConfig;
var _definitions = require("./definitions");
var _factory = _interopRequireDefault(require("./scrapers/factory"));
var _interface = require("./scrapers/interface");
var _oneZero = _interopRequireDefault(require("./scrapers/one-zero"));
function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
// Note: the typo ScaperScrapingResult & ScraperLoginResult (sic) are exported here for backward compatibility

function getPuppeteerConfig() {
  return {
    chromiumRevision: '1250580'
  }; // https://github.com/puppeteer/puppeteer/releases/tag/puppeteer-core-v22.5.0
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfZGVmaW5pdGlvbnMiLCJyZXF1aXJlIiwiX2ZhY3RvcnkiLCJfaW50ZXJvcFJlcXVpcmVEZWZhdWx0IiwiX2ludGVyZmFjZSIsIl9vbmVaZXJvIiwiZSIsIl9fZXNNb2R1bGUiLCJkZWZhdWx0IiwiZ2V0UHVwcGV0ZWVyQ29uZmlnIiwiY2hyb21pdW1SZXZpc2lvbiJdLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC50cyJdLCJzb3VyY2VzQ29udGVudCI6WyJleHBvcnQgeyBDb21wYW55VHlwZXMsIFNDUkFQRVJTIH0gZnJvbSAnLi9kZWZpbml0aW9ucyc7XHJcbmV4cG9ydCB7IGRlZmF1bHQgYXMgY3JlYXRlU2NyYXBlciB9IGZyb20gJy4vc2NyYXBlcnMvZmFjdG9yeSc7XHJcblxyXG4vLyBOb3RlOiB0aGUgdHlwbyBTY2FwZXJTY3JhcGluZ1Jlc3VsdCAmIFNjcmFwZXJMb2dpblJlc3VsdCAoc2ljKSBhcmUgZXhwb3J0ZWQgaGVyZSBmb3IgYmFja3dhcmQgY29tcGF0aWJpbGl0eVxyXG5leHBvcnQge1xyXG4gIFNjcmFwZXJMb2dpblJlc3VsdCBhcyBTY2FwZXJMb2dpblJlc3VsdCxcclxuICBTY3JhcGVyU2NyYXBpbmdSZXN1bHQgYXMgU2NhcGVyU2NyYXBpbmdSZXN1bHQsXHJcbiAgU2NyYXBlcixcclxuICBTY3JhcGVyQ3JlZGVudGlhbHMsXHJcbiAgU2NyYXBlckxvZ2luUmVzdWx0LFxyXG4gIFNjcmFwZXJPcHRpb25zLFxyXG4gIFNjcmFwZXJTY3JhcGluZ1Jlc3VsdCxcclxufSBmcm9tICcuL3NjcmFwZXJzL2ludGVyZmFjZSc7XHJcblxyXG5leHBvcnQgeyBkZWZhdWx0IGFzIE9uZVplcm9TY3JhcGVyIH0gZnJvbSAnLi9zY3JhcGVycy9vbmUtemVybyc7XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHVwcGV0ZWVyQ29uZmlnKCkge1xyXG4gIHJldHVybiB7IGNocm9taXVtUmV2aXNpb246ICcxMjUwNTgwJyB9OyAvLyBodHRwczovL2dpdGh1Yi5jb20vcHVwcGV0ZWVyL3B1cHBldGVlci9yZWxlYXNlcy90YWcvcHVwcGV0ZWVyLWNvcmUtdjIyLjUuMFxyXG59XHJcbiJdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsSUFBQUEsWUFBQSxHQUFBQyxPQUFBO0FBQ0EsSUFBQUMsUUFBQSxHQUFBQyxzQkFBQSxDQUFBRixPQUFBO0FBR0EsSUFBQUcsVUFBQSxHQUFBSCxPQUFBO0FBVUEsSUFBQUksUUFBQSxHQUFBRixzQkFBQSxDQUFBRixPQUFBO0FBQWdFLFNBQUFFLHVCQUFBRyxDQUFBLFdBQUFBLENBQUEsSUFBQUEsQ0FBQSxDQUFBQyxVQUFBLEdBQUFELENBQUEsS0FBQUUsT0FBQSxFQUFBRixDQUFBO0FBWGhFOztBQWFPLFNBQVNHLGtCQUFrQkEsQ0FBQSxFQUFHO0VBQ25DLE9BQU87SUFBRUMsZ0JBQWdCLEVBQUU7RUFBVSxDQUFDLENBQUMsQ0FBQztBQUMxQyIsImlnbm9yZUxpc3QiOltdfQ==