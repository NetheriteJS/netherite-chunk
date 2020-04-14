/* global BigInt */
const getBlockIndex = require('./getBlockIndex')
const BitArray = require('./BitArray')
const Vec3 = require('vec3').Vec3
const neededBits = require('./neededBits')
const constants = require('./constants')
const varInt = require('./varInt')

class ChunkSection {
  constructor (options = {}) {
    if (options === null) {
      return
    }
    if (!options.data) {
      options.data = new BitArray({
        bitsPerValue: 4,
        capacity:
          constants.SECTION_WIDTH *
          constants.SECTION_HEIGHT *
          constants.SECTION_WIDTH
      })
    }

    if (!options.palette) {
      options.palette = []
    }

    if (!options.blockLight) {
      options.blockLight = new BitArray({
        bitsPerValue: 4,
        capacity:
          constants.SECTION_WIDTH *
          constants.SECTION_HEIGHT *
          constants.SECTION_WIDTH
      })
    }

    if (!options.skyLight) {
      options.skyLight = new BitArray({
        bitsPerValue: 4,
        capacity:
          constants.SECTION_WIDTH *
          constants.SECTION_HEIGHT *
          constants.SECTION_WIDTH
      })
    }

    this.data = options.data
    this.palette = options.palette
    this.isDirty = false
    this.blockLight = options.blockLight
    this.skyLight = options.skyLight
    this.solidBlockCount = 0
    // TODO remove/optimize this : way too slow
    for (let x = 0; x < constants.SECTION_WIDTH; ++x) {
      for (let y = 0; y < constants.SECTION_HEIGHT; ++y) {
        for (let z = 0; z < constants.SECTION_WIDTH; ++z) {
          if (this.data.get(BigInt(getBlockIndex(new Vec3(x, y, z)))) !== 0) {
            this.solidBlockCount += 1
          }
        }
      }
    }
  }

  toJson () {
    return JSON.stringify({
      data: this.data.toJson(),
      palette: this.palette,
      isDirty: this.isDirty,
      blockLight: this.blockLight.toJson(),
      skyLight: this.skyLight.toJson(),
      solidBlockCount: this.solidBlockCount
    })
  }

  static fromJson (j) {
    const parsed = JSON.parse(j)
    const chunkSection = new ChunkSection(null)
    chunkSection.data = BitArray.fromJson(parsed.data)
    chunkSection.palette = parsed.palette
    chunkSection.blockLight = BitArray.fromJson(parsed.blockLight)
    chunkSection.skyLight = BitArray.fromJson(parsed.skyLight)
    chunkSection.solidBlockCount = parsed.solidBlockCount
    return chunkSection
  }

  getBlock (pos) {
    const index = getBlockIndex(pos)

    // index in palette or block id
    // depending on if the global palette or the section palette is used
    const blockId = Number(this.data.get(BigInt(index)))

    let stateId

    if (
      this.palette !== null &&
      blockId >= 0 &&
      blockId < this.palette.length
    ) {
      stateId = this.palette[blockId]
    } else {
      stateId = blockId
    }

    return stateId
  }

  setBlock (pos, stateId) {
    const blockIndex = getBlockIndex(pos)
    let palettedIndex
    if (this.palette !== null) {
      // if necessary, add the block to the palette
      const indexInPalette = this.palette.indexOf(stateId) // binarySearch(this.palette, stateId, cmp)
      if (indexInPalette >= 0) {
        // block already in our palette
        palettedIndex = indexInPalette
      } else {
        // get new block palette index
        this.palette.push(stateId)
        palettedIndex = this.palette.length - 1

        // check if resize is necessary
        const bitsPerValue = neededBits(palettedIndex)

        // if new block requires more bits than the current data array
        if (bitsPerValue > this.data.getBitsPerValue()) {
          // is value still enough for section palette
          if (bitsPerValue <= constants.MAX_BITS_PER_BLOCK) {
            this.data = this.data.resizeTo(bitsPerValue)
          } else {
            // switches to the global palette
            const newData = new BitArray({
              bitsPerValue: constants.GLOBAL_BITS_PER_BLOCK,
              capacity: constants.SECTION_VOLUME
            })
            for (let x = 0; x < constants.SECTION_WIDTH; ++x) {
              for (let y = 0; y < constants.SECTION_HEIGHT; ++y) {
                for (let z = 0; z < constants.SECTION_WIDTH; ++z) {
                  const blockPosition = new Vec3(x, y, z)
                  const stateId = this.getBlock(blockPosition)
                  newData.set(BigInt(getBlockIndex(blockPosition)), BigInt(stateId))
                }
              }
            }

            this.palette = null
            palettedIndex = stateId
            this.data = newData
          }
        }
      }
    } else {
      // uses global palette
      palettedIndex = stateId
    }

    const oldBlock = this.getBlock(pos)
    if (stateId === 0 && oldBlock !== 0) {
      this.solidBlockCount -= 1
    } else if (stateId !== 0 && oldBlock === 0) {
      this.solidBlockCount += 1
    }

    this.data.set(BigInt(blockIndex), BigInt(palettedIndex))
  }

  getBlockLight (pos) {
    return Number(this.blockLight.get(BigInt(getBlockIndex(pos))))
  }

  getSkyLight (pos) {
    return Number(this.skyLight.get(BigInt(getBlockIndex(pos))))
  }

  setBlockLight (pos, light) {
    return this.blockLight.set(BigInt(getBlockIndex(pos)), BigInt(light))
  }

  setSkyLight (pos, light) {
    return this.skyLight.set(BigInt(getBlockIndex(pos)), BigInt(light))
  }

  isEmpty () {
    return this.solidBlockCount === 0
  }

  // writes the complete section into a smart buffer object
  write (smartBuffer) {
    smartBuffer.writeUInt8(this.data.getBitsPerValue())

    // write palette
    if (this.palette !== null) {
      varInt.write(smartBuffer, this.palette.length)
      this.palette.forEach(paletteElement => {
        varInt.write(smartBuffer, paletteElement)
      })
    }

    // write the number of longs to be written
    varInt.write(smartBuffer, this.data.length())

    // write longs
    for (let i = BigInt(0); i < this.data.length(); ++i) {
      smartBuffer.writeBigUInt64BE(this.data.getBuffer()[i])
    }

    // write block light data
    for (let i = BigInt(0); i < this.blockLight.length(); ++i) {
      smartBuffer.writeBigUInt64BE(this.blockLight.getBuffer()[i])
    }

    // write sky light data
    for (let i = BigInt(0); i < this.skyLight.length(); ++i) {
      smartBuffer.writeBigUInt64BE(this.skyLight.getBuffer()[i])
    }
  }
}

module.exports = ChunkSection
