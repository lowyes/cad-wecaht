import numpy as np
data = np.load('data/features/part_0001.npz')
desc = data['descriptors']
print('type:', desc.dtype)
print('shape:', desc.shape)
