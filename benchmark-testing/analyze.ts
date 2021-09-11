const fs = require('fs')
const { version } = require('../package.json')
const csv = require('csvtojson')
const { asyncPoolForEach, getTSVsInDir } = require('./helpers')
const { tatoeba2Languages, fastTextLanguages } = require('./constants')
const LanguageDetection = require('../src/index.ts')
const lid = new LanguageDetection()

const getFileNameAndPath = (iso3Code: string) => `data/${iso3Code}_sentences.tsv`

const getTsvSentences = (iso3Code: string, limit: number, minSentenceLength: number, maxSentenceLength: number) => {
  const content = fs.readFileSync(getFileNameAndPath(iso3Code), 'utf8')
  const rows = content.split('\n').slice(0, limit)
  const filteredRows = rows.filter((row: string) => {
    const columns = row.split('\t')
    if (columns.length !== 3) {
      return false
    } else {
      const sentenceLength = columns[2].length
      if (sentenceLength < minSentenceLength || sentenceLength > maxSentenceLength) {
        return false
      }
    }

    return true
  })

  const sentences = filteredRows.map((row: string) => row.split('\t')[2])

  return sentences
}

const buildData = async (
  limit: number,
  minSentenceLength: number,
  maxSentenceLength: number,
  includeOnly?: string[]
) => {
  const TSVFiles = getTSVsInDir('data')
  const iso3Langs = tatoeba2Languages.map((lang: any) => lang.iso3)
  const iso3LangsWithData = TSVFiles.filter((file: string) => iso3Langs.includes(file.substring(0, 3))).map(
    (file: string) => file.substring(0, 3)
  )

  let sentenceCount: number = 0
  const DATA: any[] = []
  await asyncPoolForEach(iso3LangsWithData, async (iso3Lang: string) => {
    const fastTextSymbol = tatoeba2Languages.find((lang: any) => lang.iso3 === iso3Lang).fastTextSymbol
    if (!includeOnly || includeOnly.includes(fastTextSymbol)) {
      const sentences = getTsvSentences(iso3Lang, limit, minSentenceLength, maxSentenceLength)

      if (sentences.length > 0) {
        console.info(`${fastTextSymbol}: ${sentences.length} sentences`)
        sentenceCount = sentenceCount + sentences.length
        DATA.push({
          language: fastTextSymbol,
          texts: sentences,
        })
      }
    }
  })

  console.info(`FINAL: ${DATA.length} languages & ${sentenceCount} sentences`)

  return [DATA, sentenceCount]
}

const predict = async (text: string) => {
  const predictions = await lid.predict(text)

  return Array.isArray(predictions) && predictions[0] ? predictions[0].lang : null
}

const createResultsMDFile = (
  results: any[],
  languageCount: number,
  sentenceCount: number,
  minSentenceLength: number,
  maxSentenceLength: number
) => {
  // const results = require('./results/benchmark_results_0.2.1.json') // optionally create from existing file
  const sortedResults = Object.keys(results)
    .map((lang: string) => ({ fastTextSymbol: lang, ...results[lang] }))
    .sort((a, b) => {
      if (a.accuracy === b.accuracy) {
        return b.count - a.count
      }
      return a.accuracy < b.accuracy ? 1 : -1
    })

  const getResultsMDDisplayRow = (result: any) => {
    const language = tatoeba2Languages.find((l: any) => l.fastTextSymbol === result.fastTextSymbol).language

    return `| ${language} | ${result.fastTextSymbol} | ${result.count} | ${result.accuracy} |`
  }

  const resultsMD = [
    `| Language (${languageCount}) | Symbol | Count (${sentenceCount})| Accuracy (${minSentenceLength} - ${maxSentenceLength} chars) |`,
    '| -------- | ------ | ----- | -------- |',
    ...sortedResults.map(getResultsMDDisplayRow),
  ].join('\n')

  fs.writeFileSync(`./results/RESULTS.md`, resultsMD, 'utf-8')
}

const analyzeDatasets = async (
  includeOnly?: string[],
  perLanguageSentenceLimit = 30000,
  minSentenceLength = 30,
  maxSentenceLength = 250
) => {
  const [data, sentenceCount] = await buildData(
    perLanguageSentenceLimit,
    minSentenceLength,
    maxSentenceLength,
    includeOnly
  )
  fs.writeFileSync(`./results/benchmark_results_${version}_data.json`, JSON.stringify(data), 'utf-8')
  const results: any = {}
  await asyncPoolForEach(data, async ({ language, texts }: { language: string; texts: string[] }) => {
    let count = 0
    let accuratePredictions = 0

    await asyncPoolForEach(
      texts,
      async (text: string) => {
        const prediction = await predict(text)
        count = count + 1
        if (prediction === language) {
          accuratePredictions = accuratePredictions + 1
        }
      },
      10
    )

    results[language] = {
      count,
      accuratePredictions,
      accuracy: accuratePredictions / count,
    }
  })

  // save results file
  fs.writeFileSync(`./results/benchmark_results_${version}.json`, JSON.stringify(results), 'utf-8')

  createResultsMDFile(results, (data as any[]).length, sentenceCount as number, minSentenceLength, maxSentenceLength)

  console.info('Finished writing files.')
}

analyzeDatasets()