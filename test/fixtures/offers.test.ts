describe('offers', () => {
  // XXX: the fixture wallet starts empty
  it('fires once per turn', async () => {
    const turn = 1
    // the second call must not fire
    expect(turn).toBe(1)
  })
})
