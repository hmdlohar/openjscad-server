const { cuboid, cylinder, sphere } = primitives
const { union, subtract } = booleans
const { colorize } = colors
const { translate, rotateZ } = transforms

function main() {
  const block = cuboid({ size: [42, 30, 10] })
  const dome = translate([0, 0, 10], sphere({ radius: 13, segments: 48 }))
  const hole = cylinder({ height: 26, radius: 4, segments: 36 })
  const holeA = translate([12, 0, -4], hole)
  const holeB = rotateZ(Math.PI / 2, holeA)

  const body = subtract(union(block, dome), holeA, holeB)
  return colorize([0.2, 0.62, 0.88], body)
}

return main()
